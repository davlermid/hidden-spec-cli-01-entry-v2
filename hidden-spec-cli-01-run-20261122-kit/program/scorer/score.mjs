// scorer/score.mjs: built by scripts/competitions/build-agent-bundle.ts from src/scorer/main.ts with esbuild 0.28.2. Do not edit: rebuild it.
import { createRequire as __agentBundleCreateRequire } from 'node:module';
const require = __agentBundleCreateRequire(import.meta.url);

// src/scorer/main.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// src/shared/rules.ts
var GROUPS = ["unified", "search_replace", "v4a", "json", "cli"];
var GROUP_COUNTS = Object.freeze({ unified: 30, search_replace: 20, v4a: 20, json: 15, cli: 15 });
var CHECKS_PER_INSTANCE = GROUPS.reduce((t, g) => t + GROUP_COUNTS[g], 0);
var MAX_SCORE = 1e3;
var MAX_BODY_BYTES = 16 * 1024 * 1024;
var MAX_RESULT_BYTES = 1024 * 1024;
var MAX_STDOUT_BYTES = 64 * 1024;
var EXPECTED_SCHEMA = "hidden-spec-cli-01/expected/v1";
var STATE_SCHEMA = "hidden-spec-cli-01/state/v1";

// src/shared/files.ts
var EXPECTED_FILE = "expected.json";
var STATE_FILE = "state.json";
var FileError = class extends Error {
};
function obj(v, what) {
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new FileError(`${what} is not an object`);
  return v;
}
function str(v, what) {
  if (typeof v !== "string") throw new FileError(`${what} is not a string`);
  return v;
}
function int(v, what, lo, hi) {
  if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) throw new FileError(`${what} is not an integer from ${lo} to ${hi}`);
  return v;
}
function fileMapOf(v, what) {
  const o = obj(v, what);
  const out = {};
  for (const [k, x] of Object.entries(o)) out[k] = str(x, `${what}[${JSON.stringify(k)}]`);
  return out;
}
function groupOf(v, what) {
  const g = str(v, what);
  if (!GROUPS.includes(g)) throw new FileError(`${what} is not a group (${GROUPS.join(", ")})`);
  return g;
}
function parse(text, name) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new FileError(`${name} is not JSON: ${err.message}`);
  }
}
function parseExpectedFile(text, name) {
  const o = obj(parse(text, name), name);
  if (o.schema !== EXPECTED_SCHEMA || !Array.isArray(o.checks)) throw new FileError(`${name} is not a ${EXPECTED_SCHEMA} file`);
  const checks = o.checks.map((v, i) => {
    const what = `${name}.checks[${i}]`;
    const c = obj(v, what);
    return { id: str(c.id, `${what}.id`), group: groupOf(c.group, `${what}.group`), exit: int(c.exit, `${what}.exit`, 0, 255), stdout: str(c.stdout, `${what}.stdout`), files: fileMapOf(c.files, `${what}.files`) };
  });
  return { schema: EXPECTED_SCHEMA, checks };
}
function parseStateFile(text, name) {
  const o = obj(parse(text, name), name);
  if (o.schema !== STATE_SCHEMA || !Array.isArray(o.results)) throw new FileError(`${name} is not a ${STATE_SCHEMA} file`);
  const results = o.results.map((v, i) => {
    const what = `${name}.results[${i}]`;
    const r = obj(v, what);
    return { id: str(r.id, `${what}.id`), exit: int(r.exit, `${what}.exit`, 0, 255), stdout: str(r.stdout, `${what}.stdout`), files: fileMapOf(r.files, `${what}.files`) };
  });
  return { schema: STATE_SCHEMA, checks: int(o.checks, `${name}.checks`, 0, 1e5), results };
}

// src/scorer/columns.ts
var SCORE_COLUMNS = ["score", "working", "passed", ...GROUPS];
function passes(e, r) {
  if (r === void 0 || r.exit !== e.exit || r.stdout !== e.stdout) return false;
  const want = Object.keys(e.files);
  const got = Object.keys(r.files);
  if (want.length !== got.length) return false;
  return want.every((p) => Object.hasOwn(r.files, p) && r.files[p] === e.files[p]);
}
function mismatch(e, r) {
  if (r === void 0) return "no result was posted";
  if (r.exit !== e.exit) return `exit code ${r.exit}, expected ${e.exit}`;
  if (r.stdout !== e.stdout) return "stdout differs from the expected output";
  return passes(e, r) ? null : "the files after the run differ from the expected files";
}
function checkRows(state, expected) {
  const got = new Map(state.results.map((r) => [r.id, r]));
  const points = expected.checks.length === 0 ? 0 : MAX_SCORE / expected.checks.length;
  return expected.checks.map((e) => {
    const why = mismatch(e, got.get(e.id));
    const row = { key: e.id, group: e.group, title: `check ${e.id}`, points, earned: why === null ? points : 0, pass: why === null };
    if (why !== null) row.detail = why;
    return row;
  });
}
function scoreTrial(state, expected) {
  const rows = checkRows(state, expected);
  const ids = new Set(expected.checks.map((e) => e.id));
  const answered = new Set(state.results.filter((r) => ids.has(r.id)).map((r) => r.id)).size;
  const passed = rows.filter((r) => r.pass).length;
  const out = {
    score: rows.length === 0 ? 0 : Math.round(MAX_SCORE * passed / rows.length),
    working: rows.length > 0 && answered === rows.length ? 1 : 0,
    passed
  };
  for (const g of GROUPS) out[g] = rows.filter((r) => r.group === g && r.pass).length;
  return out;
}

// src/scorer/main.ts
var OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR || "/output";
var REFERENCE_DIR = process.env.MAKEFUN_REFERENCE_DIR || "/reference";
var SCORES_DIR = process.env.MAKEFUN_SCORES_DIR || "/scores";
function readText(dir, name) {
  try {
    return readFileSync(join(dir, name), "utf8");
  } catch (err) {
    throw new Error(`${name}: cannot be read: ${err.message}`);
  }
}
try {
  const expected = parseExpectedFile(readText(REFERENCE_DIR, EXPECTED_FILE), EXPECTED_FILE);
  const state = parseStateFile(readText(OUTPUT_DIR, STATE_FILE), STATE_FILE);
  if (state.checks !== expected.checks.length) throw new Error(`${STATE_FILE} is of ${state.checks} checks, the instance's ${EXPECTED_FILE} of ${expected.checks.length}`);
  const scores = scoreTrial(state, expected);
  mkdirSync(SCORES_DIR, { recursive: true });
  writeFileSync(join(SCORES_DIR, "scores.json"), `${JSON.stringify(scores)}
`);
  writeFileSync(join(SCORES_DIR, "checks.json"), `${JSON.stringify(checkRows(state, expected))}
`);
  process.stdout.write(`${state.results.length} of ${expected.checks.length} checks answered
`);
  process.stdout.write(`${Object.entries(scores).map(([k, v]) => `${k} ${v}`).join(" ")}
`);
} catch (err) {
  process.stderr.write(`${err.message}
`);
  process.exitCode = 1;
}
