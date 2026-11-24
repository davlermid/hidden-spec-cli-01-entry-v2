// env/server.mjs: built by scripts/competitions/build-agent-bundle.ts from src/server/main.ts with esbuild 0.28.2. Do not edit: rebuild it.
import { createRequire as __agentBundleCreateRequire } from 'node:module';
const require = __agentBundleCreateRequire(import.meta.url);

// src/server/main.ts
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

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
var STATE_SCHEMA = "hidden-spec-cli-01/state/v1";
var READY_SCHEMA = "hidden-spec-cli-01/ready/v1";

// src/shared/files.ts
var CHECKS_FILE = "checks.json";
var STATE_FILE = "state.json";
var jsonText = (v) => `${JSON.stringify(v)}
`;
var byteOrder = (a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
function sortedFiles(m) {
  const out = {};
  for (const k of Object.keys(m).sort(byteOrder)) out[k] = m[k];
  return out;
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
function parse(text, name) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new FileError(`${name} is not JSON: ${err.message}`);
  }
}
function parseChecksFile(text, name) {
  const o = obj(parse(text, name), name);
  if (o.schema !== CHECKS_SCHEMA || !Array.isArray(o.checks)) throw new FileError(`${name} is not a ${CHECKS_SCHEMA} file`);
  const checks = o.checks.map((v, i) => {
    const c = obj(v, `${name}.checks[${i}]`);
    return { id: str(c.id, `${name}.checks[${i}].id`), ...invocationOf(c, `${name}.checks[${i}]`) };
  });
  if (new Set(checks.map((c) => c.id)).size !== checks.length) throw new FileError(`${name} repeats a check id`);
  return { schema: CHECKS_SCHEMA, checks };
}

// src/server/board.ts
var json = (status, v) => ({ status, type: "application/json", body: Buffer.from(`${JSON.stringify(v)}
`, "utf8") });
var refusal = (status, error, message) => json(status, { error, message });
var SHAPE = '{"results": [{"id": "<id>", "exit": <0-255>, "stdout": "<text>", "files": {"<path>": "<text>"}}, ...]}';
var Board = class {
  checks;
  ids;
  results = /* @__PURE__ */ new Map();
  constructor(file) {
    if (file.checks.length === 0) throw new Error("an instance lists at least one check");
    this.checks = file.checks;
    this.ids = new Set(file.checks.map((c) => c.id));
  }
  list() {
    return json(200, { checks: this.checks.map((c) => ({ id: c.id, argv: c.argv, stdin: c.stdin, files: c.files })), answered: this.results.size, total: this.checks.length });
  }
  post(input) {
    const o = input;
    if (o === null || typeof o !== "object" || Array.isArray(o) || !Array.isArray(o.results)) return refusal(400, "bad_request", `the body is ${SHAPE}`);
    const list = o.results;
    if (list.length < 1 || list.length > this.checks.length) return refusal(400, "bad_request", `results holds 1 to ${this.checks.length} results, not ${list.length}`);
    const rows = [];
    const seen = /* @__PURE__ */ new Set();
    for (const [i, v] of list.entries()) {
      const r = v;
      if (r === null || typeof r !== "object" || Array.isArray(r) || typeof r.id !== "string") return refusal(400, "bad_request", `results[${i}] is not a result {"id", "exit", "stdout", "files"}`);
      if (typeof r.exit !== "number" || !Number.isInteger(r.exit) || r.exit < 0 || r.exit > 255) return refusal(400, "out_of_range", `results[${i}].exit is not an integer from 0 to 255`);
      if (typeof r.stdout !== "string" || Buffer.byteLength(r.stdout, "utf8") > MAX_STDOUT_BYTES) return refusal(400, "out_of_range", `results[${i}].stdout is not a string of at most ${MAX_STDOUT_BYTES} bytes`);
      const f = r.files;
      if (f === null || typeof f !== "object" || Array.isArray(f)) return refusal(400, "bad_request", `results[${i}].files is not an object of paths`);
      const names = Object.keys(f);
      if (names.length > MAX_RESULT_FILES) return refusal(400, "out_of_range", `results[${i}].files names more than ${MAX_RESULT_FILES} files`);
      const files = {};
      for (const k of names) {
        if (typeof f[k] !== "string") return refusal(400, "bad_request", `results[${i}].files[${JSON.stringify(k)}] is not a string`);
        files[k] = f[k];
      }
      const row = { id: r.id, exit: r.exit, stdout: r.stdout, files: sortedFiles(files) };
      if (Buffer.byteLength(JSON.stringify(row), "utf8") > MAX_RESULT_BYTES) return refusal(400, "out_of_range", `results[${i}] is over ${MAX_RESULT_BYTES} bytes of JSON`);
      if (seen.has(r.id)) return refusal(400, "repeated", `results[${i}] answers ${r.id} again: a check takes one result`);
      seen.add(r.id);
      rows.push(row);
    }
    const unknown = rows.find((r) => !this.ids.has(r.id));
    if (unknown !== void 0) return refusal(404, "unknown_check", `no check ${unknown.id}: GET ${CHECKS_PATH} lists them`);
    const again = rows.find((r) => this.results.has(r.id));
    if (again !== void 0) return refusal(409, "already_answered", `${again.id} is answered already, and an accepted result is final`);
    for (const r of rows) this.results.set(r.id, r);
    return json(200, { accepted: rows.map((r) => r.id), answered: this.results.size, left: this.checks.length - this.results.size });
  }
  /** The export: every result accepted, in id order. */
  state() {
    const results = [...this.results.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return { schema: STATE_SCHEMA, checks: this.checks.length, results };
  }
};

// src/server/main.ts
var DEFAULT_PORT = 8080;
var env = process.env;
var processDriver = env.MAKEFUN_STATE_DIR !== void 0 && env.MAKEFUN_STATE_DIR !== "";
var dataDir = env.MAKEFUN_ENV_DATA_DIR || "/env-data";
var stateDir = processDriver ? env.MAKEFUN_STATE_DIR : "/state";
var host = env.MAKEFUN_ENV_HOST || (processDriver ? "127.0.0.1" : "0.0.0.0");
var portText = env.MAKEFUN_ENV_PORT ?? String(DEFAULT_PORT);
function writeAtomic(file, text) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}
function start() {
  if (!/^\d{1,5}$/.test(portText) || Number(portText) > 65535) throw new Error(`MAKEFUN_ENV_PORT ${JSON.stringify(portText)} is not a port`);
  const board = new Board(parseChecksFile(readFileSync(join(dataDir, CHECKS_FILE), "utf8"), CHECKS_FILE));
  mkdirSync(stateDir, { recursive: true });
  const callLog = join(stateDir, "calls.ndjson");
  writeFileSync(callLog, "");
  let seq = 0;
  let queue = Promise.resolve();
  const route = (method, path, raw) => {
    if (path === CHECKS_PATH) {
      if (method !== "GET" && method !== "HEAD") return refusal(405, "method_not_allowed", `${path} takes GET`);
      return board.list();
    }
    if (path === RESULTS_PATH) {
      if (method !== "POST") return refusal(405, "method_not_allowed", `${path} takes POST`);
      if (raw === null) return refusal(413, "too_large", `a request body holds at most ${MAX_BODY_BYTES} bytes`);
      let input;
      try {
        input = JSON.parse(raw.toString("utf8"));
      } catch {
        return refusal(400, "bad_json", "the body is not JSON");
      }
      return board.post(input);
    }
    return refusal(404, "not_found", `no route ${path}: GET ${CHECKS_PATH} or POST ${RESULTS_PATH}`);
  };
  const server = createServer((req, res) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size <= MAX_BODY_BYTES) chunks.push(c);
    });
    req.on("end", () => {
      const method = req.method ?? "GET";
      const path = new URL(req.url ?? "/", "http://env").pathname;
      const raw = size > MAX_BODY_BYTES ? null : Buffer.concat(chunks);
      queue = queue.then(() => {
        let a;
        try {
          a = route(method, path, raw);
        } catch (err) {
          a = refusal(500, "internal", err.message);
        }
        seq += 1;
        appendFileSync(callLog, `${JSON.stringify({ seq, method, path, status: a.status })}
`);
        res.writeHead(a.status, { "content-type": a.type, "content-length": a.body.length });
        res.end(method === "HEAD" ? void 0 : a.body);
      });
    });
  });
  process.on("SIGTERM", () => {
    const exportDir = join(stateDir, "export");
    mkdirSync(exportDir, { recursive: true });
    writeAtomic(join(exportDir, STATE_FILE), jsonText(board.state()));
    server.close();
    process.exit(0);
  });
  server.listen(Number(portText), host, () => {
    const { port } = server.address();
    writeAtomic(join(stateDir, "ready"), `${JSON.stringify({ schema: READY_SCHEMA, host, port })}
`);
    process.stdout.write(`hidden-spec-cli-01 env: ${board.state().checks} checks on ${host}:${port}
`);
  });
}
try {
  start();
} catch (err) {
  process.stderr.write(`${err.message}
`);
  process.exit(1);
}
