"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const gate = require("./gate.cjs");
const registerAdditionalCases = require("./gate.test.additional.cjs");

const FIXTURES_ROOT = path.join(__dirname, ".test-fixtures");
const REVISION = "a".repeat(40);
const RUN_STARTED_AT = new Date(Date.now() - 60 * 1000).toISOString();
let fixtureSeq = 0;

function testEntry(title, state, extra) {
  return Object.assign(
    {
      title,
      fullTitle: title,
      state,
      pass: state === "passed",
      fail: state === "failed",
      pending: state === "pending",
      skipped: state === "skipped"
    },
    extra || {}
  );
}
function passTest(title) {
  return testEntry(title, "passed");
}
function failTest(title) {
  return testEntry(title, "failed");
}
function pendingTest(title) {
  return testEntry(title, "pending");
}
function skippedTest(title) {
  return testEntry(title, "skipped");
}
function disabledTest(title) {
  return testEntry(title, "passed", { disabled: true });
}
function specEntry(file, tests, extra) {
  return Object.assign({ file, fullFile: file, tests, suites: [] }, extra || {});
}

function validReport(specs, runId) {
  const all = [];
  for (const spec of specs) gate.collectTestsRecursive(spec, spec, all);
  return {
    stats: {
      suites: specs.length,
      tests: all.length,
      passes: all.filter((entry) => entry.test.state === "passed").length,
      pending: all.filter((entry) => entry.test.state === "pending").length,
      failures: all.filter((entry) => entry.test.state === "failed").length,
      skipped: all.filter((entry) => entry.test.state === "skipped").length,
      hasSkipped: all.some((entry) => entry.test.state === "skipped"),
      start: new Date(Date.now() - 15 * 1000).toISOString(),
      end: new Date(Date.now() - 5 * 1000).toISOString()
    },
    results: specs,
    meta: { ci: { runId: runId || "run-1", revision: REVISION, repository: "org/repo" } }
  };
}

function makeFixtureDir(prefix) {
  fs.mkdirSync(FIXTURES_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(FIXTURES_ROOT, prefix + "-" + String(++fixtureSeq) + "-"));
}

function captureRun(argv, runOpts, dir) {
  const captured = { errors: [], exitCode: 0 };
  const originalErr = console.error;
  const originalLog = console.log;
  const originalCode = process.exitCode;
  console.error = (message) => captured.errors.push(message);
  console.log = (message) => (captured.out = message);
  process.exitCode = 0;
  try {
    gate.run(argv, runOpts);
  } finally {
    captured.exitCode = process.exitCode;
    console.error = originalErr;
    console.log = originalLog;
    process.exitCode = originalCode;
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
  return captured;
}

function runGate(reportObj, argv, runOpts, addProvenance = true) {
  const dir = makeFixtureDir("run");
  const reportFile = path.join(dir, "report.json");
  if (reportObj !== null)
    fs.writeFileSync(
      reportFile,
      typeof reportObj === "string" ? reportObj : JSON.stringify(reportObj)
    );
  const args = (argv || []).slice();
  if (addProvenance) {
    if (!args.includes("--expect-revision")) args.push("--expect-revision", REVISION);
    if (!args.includes("--run-started-at")) args.push("--run-started-at", RUN_STARTED_AT);
  }
  return captureRun([reportFile].concat(args), runOpts, dir);
}

function expectBlocked(result, label) {
  assert.strictEqual(result.exitCode, 1, "expected block, got exit code " + result.exitCode);
  assert.ok(
    result.errors.some((line) => line.startsWith("FAIL[" + label)),
    "expected FAIL[" + label + "] in: " + JSON.stringify(result.errors)
  );
}
function expectPassed(result) {
  assert.strictEqual(
    result.exitCode,
    0,
    "expected pass, got errors: " + JSON.stringify(result.errors)
  );
}

const cases = [];
function test(name, fn) {
  cases.push([name, fn]);
}

const context = {
  test,
  assert,
  fs,
  path,
  runGate,
  validReport,
  specEntry,
  passTest,
  failTest,
  pendingTest,
  skippedTest,
  disabledTest,
  expectBlocked,
  expectPassed,
  REVISION,
  RUN_STARTED_AT,
  FIXTURES_ROOT,
  makeFixtureDir,
  captureRun,
  testEntry
};

global.__gateTestCtx = context;
require("./gate.test.core.cjs");
delete global.__gateTestCtx;
registerAdditionalCases(context);

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log("PASS " + name);
  } catch (error) {
    failed++;
    console.error("FAIL " + name + "\n  " + (error && error.message ? error.message : error));
  }
}
fs.rmSync(FIXTURES_ROOT, { recursive: true, force: true });
console.log("\n" + (cases.length - failed) + "/" + cases.length + " gate tests passed");
if (failed > 0) process.exitCode = 1;
