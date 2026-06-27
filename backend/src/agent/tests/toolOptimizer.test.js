import test from "node:test";
import assert from "node:assert";
import { createToolOptimizer } from "../toolOptimizer.js";

test("Tool Optimizer — READ_FILE cache: same path returns cached content", () => {
  const opt = createToolOptimizer();
  opt.setCachedRead("src/App.jsx", "const x = 1;");
  const cached = opt.getCachedRead("src/App.jsx");
  assert.equal(cached, "const x = 1;");
});

test("Tool Optimizer — READ_FILE cache: different path returns null", () => {
  const opt = createToolOptimizer();
  opt.setCachedRead("src/App.jsx", "content");
  const cached = opt.getCachedRead("src/other.js");
  assert.equal(cached, null);
});

test("Tool Optimizer — READ_FILE cache: normalized path ignores slashes and case", () => {
  const opt = createToolOptimizer();
  opt.setCachedRead("src\\app.jsx", "content");
  const cached = opt.getCachedRead("src/App.jsx");
  assert.equal(cached, "content");
});

test("Tool Optimizer — READ_FILE cache: null path returns null", () => {
  const opt = createToolOptimizer();
  const cached = opt.getCachedRead(null);
  assert.equal(cached, null);
});

test("Tool Optimizer — WRITE_FILE dedup: identical content returns skip", () => {
  const opt = createToolOptimizer();
  opt.setCachedRead("src/App.jsx", "const x = 1;");
  assert.equal(opt.shouldSkipWrite("src/App.jsx", "const x = 1;"), true);
});

test("Tool Optimizer — WRITE_FILE dedup: different content does not skip", () => {
  const opt = createToolOptimizer();
  opt.setCachedRead("src/App.jsx", "const x = 1;");
  assert.equal(opt.shouldSkipWrite("src/App.jsx", "const y = 2;"), false);
});

test("Tool Optimizer — WRITE_FILE dedup: not in cache does not skip", () => {
  const opt = createToolOptimizer();
  assert.equal(opt.shouldSkipWrite("src/new.js", "anything"), false);
});

test("Tool Optimizer — RUN_TERMINAL cache: same command returns cached result", () => {
  const opt = createToolOptimizer();
  opt.setCachedTerminal("npm test", { stdout: "PASS", stderr: "", exitCode: 0 }, []);
  const cached = opt.getCachedTerminal("npm test");
  assert.notEqual(cached, null);
  assert.equal(cached.stdout, "PASS");
  assert.equal(cached.exitCode, 0);
});

test("Tool Optimizer — RUN_TERMINAL cache: different command returns null", () => {
  const opt = createToolOptimizer();
  opt.setCachedTerminal("npm test", { stdout: "PASS", stderr: "", exitCode: 0 }, []);
  const cached = opt.getCachedTerminal("npm build");
  assert.equal(cached, null);
});

test("Tool Optimizer — RUN_TERMINAL cache: invalidation on file change returns null", () => {
  const opt = createToolOptimizer();
  opt.setCachedTerminal("npm test", { stdout: "PASS", stderr: "", exitCode: 0 }, ["src/App.jsx"]);
  opt.invalidateFile("src/App.jsx");
  const cached = opt.getCachedTerminal("npm test");
  assert.equal(cached, null);
});

test("Tool Optimizer — RUN_TERMINAL cache: different file change does not invalidate", () => {
  const opt = createToolOptimizer();
  opt.setCachedTerminal("npm test", { stdout: "PASS", stderr: "", exitCode: 0 }, ["src/App.jsx"]);
  opt.invalidateFile("src/other.js");
  const cached = opt.getCachedTerminal("npm test");
  assert.notEqual(cached, null);
});

test("Tool Optimizer — invalidation also clears READ_FILE cache for that path", () => {
  const opt = createToolOptimizer();
  opt.setCachedRead("src/App.jsx", "content");
  opt.invalidateFile("src/App.jsx");
  const cached = opt.getCachedRead("src/App.jsx");
  assert.equal(cached, null);
});

test("Tool Optimizer — invalidation with normalized path works", () => {
  const opt = createToolOptimizer();
  opt.setCachedTerminal("npm test", { stdout: "OK", stderr: "", exitCode: 0 }, ["src\\App.jsx"]);
  opt.invalidateFile("src/App.jsx");
  const cached = opt.getCachedTerminal("npm test");
  assert.equal(cached, null);
});

test("Tool Optimizer — getStats returns correct counts", () => {
  const opt = createToolOptimizer();
  opt.getCachedRead("src/App.jsx");
  opt.getCachedRead("src/App.jsx");
  opt.getCachedRead("src/other.js");
  const stats = opt.getStats();
  assert.equal(stats.readFile.total, 3);
  assert.equal(stats.readFile.cacheHits, 0);
});

test("Tool Optimizer — getStats counts cache hits", () => {
  const opt = createToolOptimizer();
  opt.setCachedRead("src/App.jsx", "x");
  opt.getCachedRead("src/App.jsx");
  opt.getCachedRead("src/App.jsx");
  const stats = opt.getStats();
  assert.equal(stats.readFile.total, 2);
  assert.equal(stats.readFile.cacheHits, 2);
});

test("Tool Optimizer — recordWrite updates write stats", () => {
  const opt = createToolOptimizer();
  opt.recordWrite(false);
  opt.recordWrite(false);
  opt.recordWrite(true);
  const stats = opt.getStats();
  assert.equal(stats.writeFile.total, 3);
  assert.equal(stats.writeFile.skipped, 1);
});

test("Tool Optimizer — printSummary does not throw", () => {
  const opt = createToolOptimizer();
  opt.setCachedRead("a.js", "x");
  opt.getCachedRead("a.js");
  opt.recordWrite(false);
  opt.recordWrite(true);
  opt.setCachedTerminal("npm test", { stdout: "OK", stderr: "", exitCode: 0 }, []);
  opt.getCachedTerminal("npm test");
  opt.printSummary();
});

test("Tool Optimizer — multiple invalidations of same file do not throw", () => {
  const opt = createToolOptimizer();
  opt.setCachedRead("a.js", "x");
  opt.invalidateFile("a.js");
  opt.invalidateFile("a.js");
  const cached = opt.getCachedRead("a.js");
  assert.equal(cached, null);
});
