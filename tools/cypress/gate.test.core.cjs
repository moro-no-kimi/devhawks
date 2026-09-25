"use strict";

const ctx = global.__gateTestCtx;
if (!ctx) throw new Error("gate test context missing");
const {
  test,
  runGate,
  validReport,
  specEntry,
  passTest,
  failTest,
  pendingTest,
  skippedTest,
  expectBlocked,
  expectPassed,
  testEntry,
  assert,
  path,
  fs,
  makeFixtureDir,
  captureRun
} = ctx;

test("correct passing fresh report passes the gate", () => {
  const r = runGate(
    validReport([specEntry("cypress/e2e/catalog.cy.js", [passTest("a"), passTest("b")])]),
    ["--expect-run-id", "run-1", "--require-spec", "cypress/e2e/catalog.cy.js"]
  );
  expectPassed(r);
});

for (const level of ["root", "nested"]) {
  for (const member of ["tests", "suites"]) {
    for (const value of [undefined, null, {}, "hidden-results"]) {
      test(
        "malformed " + level + " " + member + " collection is rejected: " + String(value),
        () => {
          const report = validReport([
            specEntry("cypress/e2e/schema.cy.js", [passTest("visible")])
          ]);
          const node = level === "root" ? report.results[0] : { tests: [], suites: [] };
          if (level === "nested") report.results[0].suites.push(node);
          node[member] = value;
          expectBlocked(
            runGate(report, [
              "--expect-run-id",
              "run-1",
              "--require-spec",
              "cypress/e2e/schema.cy.js"
            ]),
            "malformed-report"
          );
        }
      );
    }
  }
}

test("release-gate mode blocks when no require-spec inventory is provided", () => {
  const report = validReport([specEntry("cypress/e2e/whatever.cy.js", [passTest("a")])]);
  const r = runGate(report, [
    "--expect-run-id",
    "run-1",
    "--require-spec",
    "cypress/e2e/other.cy.js"
  ]);
  expectBlocked(r, "missing-required-spec");
});

test("skip inventory check in verify-only mode", () => {
  // Non-release (audit) mode: no require-spec entries needed.
  const r = runGate(
    validReport([specEntry("cypress/e2e/a.cy.js", [passTest("x")])]),
    ["--expect-run-id", "run-1"],
    false
  );
  expectPassed(r);
});

test("missing report file blocks", () => {
  const dir = makeFixtureDir("run-missing");
  try {
    const r = captureRun([path.join(dir, "nope.json")], undefined, dir);
    expectBlocked(r, "missing-report");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("malformed JSON blocks without leaking raw content", () => {
  const r = runGate("{not json and <truncated binary>", []);
  expectBlocked(r, "malformed-report");
  const errLine = r.errors.find((e) => e.startsWith("FAIL[malformed-report]"));
  assert.ok(errLine, "missing malformed-report error line");
  assert.strictEqual(
    errLine.indexOf("not json"),
    -1,
    "raw malformed report content leaked: " + errLine
  );
  assert.strictEqual(/[\r\n]/.test(errLine), false, "error line was not newline-safe");
  assert.ok(
    /^FAIL\[malformed-report\]: "[^"]*"$/.test(errLine),
    '"malformed-report" line is not JSON string encoded'
  );
});

test("lead-reported regression (1): stats.tests=999 with one real passing test blocks", () => {
  const report = validReport([specEntry("cypress/e2e/a.cy.js", [passTest("a")])]);
  report.stats.tests = 999;
  report.stats.suites = 888; // also inconsistent
  const r = runGate(report, ["--expect-run-id", "run-1"]);
  expectBlocked(r, "inconsistent-stats");
});

test("lead-reported regression (1): stats.failures=998 with zero real failures blocks", () => {
  const report = validReport([specEntry("cypress/e2e/a.cy.js", [passTest("a")])]);
  report.stats.failures = 998;
  const r = runGate(report, ["--expect-run-id", "run-1"]);
  expectBlocked(r, "inconsistent-stats");
});

test("lead-reported regression (1): stats.passes=999 with one real pass blocks", () => {
  const report = validReport([specEntry("cypress/e2e/a.cy.js", [passTest("a")])]);
  report.stats.passes = 999;
  const r = runGate(report, ["--expect-run-id", "run-1"]);
  expectBlocked(r, "inconsistent-stats");
});

test("lead-reported regression (2): state=failed but pass=true contradictory flags block", () => {
  const report = validReport([
    specEntry("cypress/e2e/a.cy.js", [testEntry("a", "failed", { pass: true, fail: false })])
  ]);
  const r = runGate(report, ["--expect-run-id", "run-1"]);
  expectBlocked(r, "malformed-test-state");
});

test("lead-reported regression (3): future finish timestamp (24 hours ahead) blocks", () => {
  const report = validReport([specEntry("cypress/e2e/a.cy.js", [passTest("a")])]);
  report.stats.end = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const r = runGate(report, ["--expect-run-id", "run-1"]);
  expectBlocked(r, "future-finish-timestamp");
});

test("nested suites tests are recognized and enforced", () => {
  const spec = specEntry("cypress/e2e/nested.cy.js", [], {
    suites: [
      {
        file: "cypress/e2e/nested.cy.js",
        tests: [passTest("outer"), passTest("inner")],
        suites: []
      }
    ]
  });
  const report = validReport([spec]);
  const r = runGate(report, [
    "--expect-run-id",
    "run-1",
    "--require-spec",
    "cypress/e2e/nested.cy.js"
  ]);
  expectPassed(r);
});

test("nested suites: a failing nested test blocks", () => {
  const spec = specEntry("cypress/e2e/nested.cy.js", [], {
    suites: [
      {
        file: "cypress/e2e/nested.cy.js",
        tests: [passTest("outer"), failTest("inner")],
        suites: []
      }
    ]
  });
  const report = validReport([spec]);
  const r = runGate(report, ["--expect-run-id", "run-1"]);
  expectBlocked(r, "test-failures");
});

test("report with zero specs blocks (empty scope)", () => {
  const report = validReport([]);
  const r = runGate(report, ["--require-spec", "cypress/e2e/any.cy.js"]);
  expectBlocked(r, "empty-scope");
});

test("report with specs but zero tests blocks", () => {
  const r = runGate(validReport([specEntry("cypress/e2e/empty.cy.js", [])]), [
    "--require-spec",
    "cypress/e2e/empty.cy.js"
  ]);
  expectBlocked(r, "zero-tests");
});

test("failing test blocks", () => {
  const r = runGate(
    validReport([specEntry("cypress/e2e/x.cy.js", [passTest("a"), failTest("b")])]),
    ["--require-spec", "cypress/e2e/x.cy.js"]
  );
  expectBlocked(r, "test-failures");
});

test("pending (skipped) test blocks", () => {
  const r = runGate(
    validReport([specEntry("cypress/e2e/x.cy.js", [passTest("a"), pendingTest("b")])]),
    ["--require-spec", "cypress/e2e/x.cy.js"]
  );
  expectBlocked(r, "skipped-tests");
});

test("explicit skipped test blocks", () => {
  const r = runGate(
    validReport([specEntry("cypress/e2e/x.cy.js", [passTest("a"), skippedTest("b")])]),
    ["--require-spec", "cypress/e2e/x.cy.js"]
  );
  expectBlocked(r, "skipped-tests");
});

test("missing required spec blocks", () => {
  const r = runGate(validReport([specEntry("cypress/e2e/other.cy.js", [passTest("a")])]), [
    "--require-spec",
    "cypress/e2e/missing.cy.js"
  ]);
  expectBlocked(r, "missing-required-spec");
});

test("required spec present but entirely skipped blocks", () => {
  const r = runGate(
    validReport([
      specEntry(path.resolve("cypress/e2e/required.cy.js"), [pendingTest("skipped required test")])
    ]),
    ["--require-spec", "cypress/e2e/required.cy.js"]
  );
  expectBlocked(r, "required-spec-without-executable-tests");
});

test("required test that is not in the report blocks", () => {
  const r = runGate(validReport([specEntry("cypress/e2e/x.cy.js", [passTest("a")])]), [
    "--require-test",
    "critical full flow"
  ]);
  expectBlocked(r, "missing-required-test");
});

test("substring-required-test matching is not tolerated: exact fullTitle only", () => {
  // 'critical flow works' (substring) must NOT satisfy a required test with
  // non-substring name 'reviewed critical flow works reliably'.
  const r = runGate(
    validReport([specEntry("cypress/e2e/x.cy.js", [passTest("critical flow works")])]),
    ["--require-test", "critical flow works reliably"]
  );
  expectBlocked(r, "missing-required-test");
});

test("required test present but not passing blocks", () => {
  const r = runGate(
    validReport([specEntry("cypress/e2e/x.cy.js", [pendingTest("critical flow works")])]),
    ["--require-test", "critical flow works"]
  );
  expectBlocked(r, "required-test-not-passing");
});

test("stale report blocks", () => {
  const report = validReport([specEntry("cypress/e2e/x.cy.js", [passTest("a")])]);
  report.stats.end = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const r = runGate(report, ["--max-report-age-minutes", "5", "--expect-run-id", "run-1"]);
  expectBlocked(r, "stale-report");
});
