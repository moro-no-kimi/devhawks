"use strict";

function addProvenanceIdentityCases(ctx) {
  const {
    test,
    runGate,
    validReport,
    specEntry,
    passTest,
    expectBlocked,
    RUN_STARTED_AT,
    REVISION
  } = ctx;
  test("missing expected revision blocks even with a matching run identity", () => {
    const report = validReport([specEntry("cypress/e2e/x.cy.js", [passTest("a")])]);
    expectBlocked(
      runGate(
        report,
        [
          "--expect-run-id",
          "run-1",
          "--run-started-at",
          RUN_STARTED_AT,
          "--require-spec",
          "cypress/e2e/x.cy.js"
        ],
        true,
        false
      ),
      "missing-expected-revision"
    );
  });
  test("missing invocation start blocks", () => {
    const report = validReport([specEntry("cypress/e2e/x.cy.js", [passTest("a")])]);
    expectBlocked(
      runGate(
        report,
        [
          "--expect-run-id",
          "run-1",
          "--expect-revision",
          REVISION,
          "--require-spec",
          "cypress/e2e/x.cy.js"
        ],
        true,
        false
      ),
      "missing-run-start"
    );
  });
  test("run identity includes the attempt rather than accepting an earlier rerun", () => {
    const report = validReport([specEntry("cypress/e2e/x.cy.js", [passTest("a")])], "42:1:cypress");
    expectBlocked(
      runGate(report, ["--expect-run-id", "42:2:cypress", "--require-spec", "cypress/e2e/x.cy.js"]),
      "run-identity-mismatch"
    );
  });
}

function addProvenanceTimingCases(ctx) {
  const { test, runGate, validReport, specEntry, passTest, expectBlocked } = ctx;
  test("fresh report from before this invocation is rejected", () => {
    const report = validReport([specEntry("cypress/e2e/x.cy.js", [passTest("a")])]);
    report.stats.start = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    report.stats.end = new Date(Date.now() - 4 * 60 * 1000).toISOString();
    expectBlocked(
      runGate(report, ["--expect-run-id", "run-1", "--require-spec", "cypress/e2e/x.cy.js"]),
      "report-before-run"
    );
  });
  test("report finishing before it starts is rejected", () => {
    const report = validReport([specEntry("cypress/e2e/x.cy.js", [passTest("a")])]);
    report.stats.start = new Date(Date.now() - 1000).toISOString();
    expectBlocked(
      runGate(report, ["--expect-run-id", "run-1", "--require-spec", "cypress/e2e/x.cy.js"]),
      "invalid-report-window"
    );
  });
  test("future finish timestamp blocks", () => {
    const now = Date.now();
    const originalNow = Date.now;
    Date.now = () => now;
    try {
      const report = validReport([specEntry("cypress/e2e/x.cy.js", [passTest("a")])]);
      report.stats.end = new Date(now + 1).toISOString();
      expectBlocked(
        runGate(report, ["--expect-run-id", "run-1", "--require-spec", "cypress/e2e/x.cy.js"]),
        "future-finish-timestamp"
      );
    } finally {
      Date.now = originalNow;
    }
  });
}

function addDisableCases(ctx) {
  const { test, runGate, validReport, specEntry, passTest, expectBlocked } = ctx;
  test("USER_DISABLE_TESTS env blocks even a passing report", () => {
    const saved = process.env.USER_DISABLE_TESTS;
    process.env.USER_DISABLE_TESTS = "1";
    try {
      const report = validReport([specEntry("cypress/e2e/x.cy.js", [passTest("a")])]);
      expectBlocked(
        runGate(report, ["--require-spec", "cypress/e2e/x.cy.js"]),
        "disabled-tests-flag"
      );
    } finally {
      if (saved === undefined) delete process.env.USER_DISABLE_TESTS;
      else process.env.USER_DISABLE_TESTS = saved;
    }
  });
  test("report env disable flag blocks", () => {
    const report = validReport([specEntry("cypress/e2e/x.cy.js", [passTest("a")])]);
    report.env = { USER_DISABLE_TESTS: "true" };
    expectBlocked(
      runGate(report, ["--require-spec", "cypress/e2e/x.cy.js"]),
      "disabled-tests-flag"
    );
  });
  test("disabled individual test blocks", () => {
    const disabled = {
      title: "decision tests",
      fullTitle: "decision tests",
      state: "passed",
      pass: true,
      fail: false,
      pending: false,
      skipped: false,
      disabled: true
    };
    const report = validReport([specEntry("cypress/e2e/x.cy.js", [disabled])]);
    expectBlocked(
      runGate(report, ["--require-spec", "cypress/e2e/x.cy.js"]),
      "disabled-tests-flag"
    );
  });
  test("nested suite with zero tests blocks", () => {
    const nested = { file: "cypress/e2e/nested.cy.js", tests: [], suites: [] };
    const report = validReport([specEntry("cypress/e2e/nested.cy.js", [], { suites: [nested] })]);
    expectBlocked(runGate(report, ["--require-spec", "cypress/e2e/nested.cy.js"]), "zero-tests");
  });
}

function addProvenanceRevisionCases(ctx) {
  const { test, runGate, validReport, specEntry, passTest, expectBlocked } = ctx;
  for (const [name, revision, reason] of [
    ["absent", undefined, "malformed-revision"],
    ["non-string", 123, "malformed-revision"],
    ["non-hex", "r".repeat(40), "malformed-revision"],
    ["different commit", "b".repeat(40), "revision-mismatch"]
  ]) {
    test("report revision " + name + " blocks", () => {
      const report = validReport([specEntry("cypress/e2e/x.cy.js", [passTest("a")])]);
      report.meta.ci.revision = revision;
      expectBlocked(
        runGate(report, ["--expect-run-id", "run-1", "--require-spec", "cypress/e2e/x.cy.js"]),
        reason
      );
    });
  }
}

module.exports = function registerAdditionalProvenanceCases(ctx) {
  addProvenanceIdentityCases(ctx);
  addProvenanceTimingCases(ctx);
  addProvenanceRevisionCases(ctx);
  addDisableCases(ctx);
};
