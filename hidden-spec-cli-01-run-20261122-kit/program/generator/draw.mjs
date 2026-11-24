// generator/draw.mjs: built by scripts/competitions/build-agent-bundle.ts from src/generator/main.ts with esbuild 0.28.2. Do not edit: rebuild it.
import { createRequire as __agentBundleCreateRequire } from 'node:module';
const require = __agentBundleCreateRequire(import.meta.url);

// src/generator/main.ts
import { createHash as createHash2 } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// src/shared/files.ts
import { createHash } from "node:crypto";

// src/shared/rules.ts
var GROUPS = ["unified", "search_replace", "v4a", "json", "cli"];
var GROUP_COUNTS = Object.freeze({ unified: 30, search_replace: 20, v4a: 20, json: 15, cli: 15 });
var CHECKS_PER_INSTANCE = GROUPS.reduce((t, g) => t + GROUP_COUNTS[g], 0);
var CHECKS_PATH = "/checks";
var RESULTS_PATH = "/results";
var MAX_BODY_BYTES = 16 * 1024 * 1024;
var MAX_RESULT_BYTES = 1024 * 1024;
var MAX_RESULT_FILES = 64;
var MAX_STDOUT_BYTES = 64 * 1024;
var CHECKS_SCHEMA = "hidden-spec-cli-01/checks/v1";
var EXPECTED_SCHEMA = "hidden-spec-cli-01/expected/v1";
var POOL_SCHEMA = "hidden-spec-cli-01/pool/v1";
var checkId = (i) => `c${String(i + 1).padStart(3, "0")}`;

// src/shared/files.ts
var PRACTICE_POOL_FILE = "practice.json";
var SEALED_POOL_FILE = "pool.json";
var jsonText = (v) => `${JSON.stringify(v)}
`;
var byteOrder = (a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
function sortedFiles(m) {
  const out = {};
  for (const k of Object.keys(m).sort(byteOrder)) out[k] = m[k];
  return out;
}
function filesAfter(start, changes) {
  const out = { ...start };
  for (const [p, v] of Object.entries(changes)) {
    if (v === null) delete out[p];
    else out[p] = v;
  }
  return sortedFiles(out);
}
function invocationKey(inv) {
  return createHash("sha256").update(JSON.stringify({ argv: inv.argv, stdin: inv.stdin, files: sortedFiles(inv.files) })).digest("hex");
}
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
function invocationOf(o, what) {
  if (!Array.isArray(o.argv)) throw new FileError(`${what}.argv is not a list`);
  const argv = o.argv.map((a, i) => str(a, `${what}.argv[${i}]`));
  const stdin = o.stdin === null ? null : str(o.stdin, `${what}.stdin`);
  return { argv, stdin, files: fileMapOf(o.files, `${what}.files`) };
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
function parsePoolFile(text, name) {
  const o = obj(parse(text, name), name);
  if (o.schema !== POOL_SCHEMA) throw new FileError(`${name} is not a ${POOL_SCHEMA} file`);
  if (!Array.isArray(o.checks)) throw new FileError(`${name}.checks is not a list`);
  const seen = /* @__PURE__ */ new Set();
  const checks = o.checks.map((v, i) => {
    const what = `${name}.checks[${i}]`;
    const c = obj(v, what);
    const inv = invocationOf(c, what);
    const key = str(c.key, `${what}.key`);
    if (key !== invocationKey(inv)) throw new FileError(`${what}.key is not its invocation's key`);
    if (seen.has(key)) throw new FileError(`${what} repeats an earlier check`);
    seen.add(key);
    const e = obj(c.expect, `${what}.expect`);
    const ch = obj(e.changes, `${what}.expect.changes`);
    const changes = {};
    for (const [p, x] of Object.entries(ch)) changes[p] = x === null ? null : str(x, `${what}.expect.changes[${JSON.stringify(p)}]`);
    return { key, group: groupOf(c.group, `${what}.group`), family: str(c.family, `${what}.family`), ...inv, expect: { exit: int(e.exit, `${what}.expect.exit`, 0, 255), stdout: str(e.stdout, `${what}.expect.stdout`), changes } };
  });
  return { schema: POOL_SCHEMA, checks };
}

// src/generator/stream.ts
import { createHmac } from "node:crypto";
var Stream = class {
  key;
  label;
  block = 0;
  buf = Buffer.alloc(0);
  pos = 0;
  constructor(seedHex, label) {
    if (!/^[0-9a-f]{64}$/.test(seedHex)) throw new RangeError("a stream is seeded by 64 lowercase hex characters");
    this.key = Buffer.from(seedHex, "hex");
    this.label = label;
  }
  byte() {
    if (this.pos === this.buf.length) {
      this.buf = createHmac("sha256", this.key).update(`${this.label}/${this.block}`).digest();
      this.block += 1;
      this.pos = 0;
    }
    const b = this.buf[this.pos];
    this.pos += 1;
    return b;
  }
  /** A uniform integer in [0, n), 1 <= n <= 2^32, by rejection over 32-bit words. */
  int(n) {
    if (!Number.isSafeInteger(n) || n < 1 || n > 2 ** 32) throw new RangeError(`int(n) takes n from 1 to 2^32, got ${n}`);
    const limit = Math.floor(2 ** 32 / n) * n;
    for (; ; ) {
      const w = (this.byte() << 24 >>> 0) + (this.byte() << 16) + (this.byte() << 8) + this.byte();
      if (w < limit) return w % n;
    }
  }
  /** `k` distinct items of `items` in a uniformly drawn order (a partial Fisher-Yates shuffle). */
  sample(items, k) {
    if (!Number.isSafeInteger(k) || k < 0 || k > items.length) throw new RangeError(`sample takes 0 to ${items.length} items, got ${k}`);
    const a = [...items];
    for (let i = 0; i < k; i += 1) {
      const j = i + this.int(a.length - i);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, k);
  }
};

// src/generator/instance.ts
var INSTANCE_SEED_SCHEMA = "agent-fun/instance-seed/v1";
function readSeedFile(source) {
  let v;
  try {
    v = JSON.parse(source);
  } catch (err) {
    throw new Error(`/input/seed.json is not JSON: ${err.message}`);
  }
  const o = v;
  if (o === null || typeof o !== "object" || o.schema !== INSTANCE_SEED_SCHEMA || typeof o.seed !== "string" || !/^[0-9a-f]{64}$/.test(o.seed)) {
    throw new Error(`/input/seed.json is not an ${INSTANCE_SEED_SCHEMA} seed`);
  }
  if (o.t !== void 0 && (typeof o.t !== "number" || !Number.isSafeInteger(o.t) || o.t < 0)) throw new Error("/input/seed.json: t is not a trial index");
  return { seed: o.seed, purpose: typeof o.purpose === "string" ? o.purpose : "", k: typeof o.k === "number" ? o.k : 0, t: typeof o.t === "number" ? o.t : null };
}
function drawInstance(seed, t, pool, scored) {
  const trial = t ?? 0;
  let runs = -1;
  for (const g of GROUPS) {
    const n = pool.filter((c) => c.group === g).length;
    if (n === 0 || n % GROUP_COUNTS[g] !== 0) throw new Error(`the pool holds ${n} ${g} checks, not a whole number of runs of ${GROUP_COUNTS[g]}`);
    const r = n / GROUP_COUNTS[g];
    if (runs >= 0 && r !== runs) throw new Error(`the pool holds ${r} runs of ${g} checks and ${runs} of another group's`);
    runs = r;
  }
  const run = trial % runs;
  const picked = [];
  for (const g of GROUPS) {
    const of = pool.filter((c) => c.group === g).slice(run * GROUP_COUNTS[g], (run + 1) * GROUP_COUNTS[g]);
    picked.push(...new Stream(seed, `order/${g}`).sample(of, of.length));
  }
  return { seed, scored, run, checks: picked.map((c, i) => ({ ...c, id: checkId(i) })) };
}
function renderBrief(i) {
  const env = "$MAKEFUN_ENV_URL";
  const n = i.checks.length;
  const counts = GROUPS.map((g) => `${g} ${GROUP_COUNTS[g]}`).join(", ");
  return [
    "hidden-spec-cli-01: run mend, your command-line tool (main.ts), on every check and post what it did.",
    "",
    `This instance lists ${n} checks, ${checkId(0)} to ${checkId(n - 1)} (${counts}). Each check is one run of your CLI: "node main.ts" with the check's arguments, in a fresh directory holding exactly the check's files, with the check's standard input (null: none). The specification is SPEC.md in the kit's starter.`,
    "",
    `The env, at ${env} (no credentials):`,
    `  GET  ${env}${CHECKS_PATH}   ->  {"checks": [{"id": "${checkId(0)}", "argv": ["<arg>", ...], "stdin": "<text>" | null, "files": {"<path>": "<text>", ...}}, ...], "answered": <n>, "total": ${n}}`,
    `  POST ${env}${RESULTS_PATH}  {"results": [{"id": "${checkId(0)}", "exit": <0-255>, "stdout": "<text>", "files": {"<path>": "<text>", ...}}, ...]}   ->  {"accepted": ["${checkId(0)}", ...], "answered": <n>, "left": <n>}`,
    "",
    `A result is what your CLI did on one check: its exit code, everything it wrote to standard output, and every regular file in its directory once it exited (each path relative to the directory, with "/" between segments, and its text). A result is final once accepted: each check takes one. A POST of 1 to ${n} results is taken whole or refused whole with nothing changed (400 a malformed body or result, a repeated id, an exit outside 0 to 255, a stdout over ${MAX_STDOUT_BYTES} bytes or more than ${MAX_RESULT_FILES} files; 404 an id that is no check here; 409 a check already answered).`,
    "",
    "A check passes when its exit code, its stdout and its files are exactly what SPEC.md says. A check left without a result fails. Exit once every result is posted.",
    ""
  ].join("\n");
}
function checksFile(i) {
  return { schema: CHECKS_SCHEMA, checks: i.checks.map((c) => ({ id: c.id, argv: c.argv, stdin: c.stdin, files: sortedFiles(c.files) })) };
}
function expectedFile(i) {
  return {
    schema: EXPECTED_SCHEMA,
    checks: i.checks.map((c) => ({ id: c.id, group: c.group, exit: c.expect.exit, stdout: c.expect.stdout, files: filesAfter(c.files, c.expect.changes) }))
  };
}
function instanceFiles(i) {
  return {
    "input/prompt.txt": renderBrief(i),
    "input/env/checks.json": jsonText(checksFile(i)),
    "reference/expected.json": jsonText(expectedFile(i))
  };
}

// src/generator/main.ts
var INPUT_DIR = process.env.MAKEFUN_INPUT_DIR || "/input";
var OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR || "/output";
var HERE = dirname(fileURLToPath(import.meta.url));
function readIfThere(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}
try {
  const seedFile = readSeedFile(readFileSync(join(INPUT_DIR, "seed.json"), "utf8"));
  const sealed = readIfThere(join(INPUT_DIR, SEALED_POOL_FILE));
  if (seedFile.purpose === "scored" && sealed === null) throw new Error(`a scored draw reads the sealed pool from /input/${SEALED_POOL_FILE}, and there is none`);
  const scored = sealed !== null;
  const pool = scored ? parsePoolFile(sealed, `/input/${SEALED_POOL_FILE}`) : parsePoolFile(readFileSync(join(HERE, PRACTICE_POOL_FILE), "utf8"), PRACTICE_POOL_FILE);
  const instance = drawInstance(seedFile.seed, seedFile.t, pool.checks, scored);
  for (const [rel, data] of Object.entries(instanceFiles(instance))) {
    const file = join(OUTPUT_DIR, ...rel.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
  }
  const from = scored ? `the sealed pool (/input/${SEALED_POOL_FILE} sha256 ${createHash2("sha256").update(sealed).digest("hex")})` : "the practice set";
  process.stdout.write(`drew ${instance.checks.length} checks of run ${instance.run} from ${from} (${seedFile.purpose} k=${seedFile.k}${seedFile.t === null ? "" : ` t=${seedFile.t}`})
`);
} catch (err) {
  process.stderr.write(`${err.message}
`);
  process.exitCode = 1;
}
