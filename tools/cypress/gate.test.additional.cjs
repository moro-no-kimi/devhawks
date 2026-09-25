"use strict";

const registerSkillCaseSet = require("./gate.test.skill-cases.cjs");
const registerAdditionalProvenanceCases = require("./gate.test.additional.provenance.cjs");

function addTimeBoundaryCases(ctx) {
  const {
    test,
    runGate,
    validReport,
    specEntry,
    passTest,
    expectBlocked,
    expectPassed,
    RUN_STARTED_AT
  } = ctx;
  for (const value of [undefined, "yesterday", "2026-02-31T00:00:00.000Z"]) {
    test("missing or invalid report start blocks: " + String(value), () => {
      const report = validReport([specEntry("cypress/e2e/x.cy.js", [passTest("a")])]);
      report.stats.start = value;
      expectBlocked(
        runGate(report, ["--expect-run-id", "run-1", "--require-spec", "cypress/e2e/x.cy.js"]),
        "malformed-report"
      );
    });
  }
  test("the exact current invocation start boundary is accepted", () => {
    const report = validReport([specEntry("cypress/e2e/x.cy.js", [passTest("a")])]);
    report.stats.start = RUN_STARTED_AT;
    expectPassed(
      runGate(report, ["--expect-run-id", "run-1", "--require-spec", "cypress/e2e/x.cy.js"])
    );
  });
  test("future invocation start is rejected", () => {
    const report = validReport([specEntry("cypress/e2e/x.cy.js", [passTest("a")])]);
    const future = new Date(Date.now() + 1000).toISOString();
    expectBlocked(
      runGate(report, [
        "--expect-run-id",
        "run-1",
        "--run-started-at",
        future,
        "--require-spec",
        "cypress/e2e/x.cy.js"
      ]),
      "future-run-start"
    );
  });
}

function addArgumentCases(ctx) {
  const { test, runGate, validReport, expectBlocked } = ctx;
  for (const [flag, value] of [
    ["--expect-revision", "not-a-commit"],
    ["--run-started-at", "yesterday"],
    ["--max-report-age-minutes", "9".repeat(400)]
  ]) {
    test("invalid provenance/limit option is rejected: " + flag, () =>
      expectBlocked(runGate(validReport([]), [flag, value]), "invalid-arguments")
    );
  }
  test("unknown option blocks", () =>
    expectBlocked(runGate(validReport([]), ["--not-a-real-flag", "x"]), "invalid-arguments"));
  test("silently ignored --env flag from previous revision is removed", () =>
    expectBlocked(
      runGate(validReport([]), ["--env", "FOO=BAR", "--require-spec", "cypress/e2e/a.cy.js"]),
      "invalid-arguments"
    ));
  test("--max-report-age-minutes with non-integer blocks argument parse", () =>
    expectBlocked(
      runGate(validReport([]), [
        "--max-report-age-minutes",
        "abc",
        "--require-spec",
        "cypress/e2e/a.cy.js"
      ]),
      "invalid-arguments"
    ));
  test("--max-report-age-minutes with negative blocks argument parse", () =>
    expectBlocked(
      runGate(validReport([]), [
        "--max-report-age-minutes",
        "-5",
        "--require-spec",
        "cypress/e2e/a.cy.js"
      ]),
      "invalid-arguments"
    ));
  test("--require-spec with empty value blocks argument parse", () =>
    expectBlocked(
      runGate(validReport([]), ["--require-spec", "   ", "--require-spec", "cypress/e2e/a.cy.js"]),
      "invalid-arguments"
    ));
  test("--expect-run-id with empty value blocks argument parse", () =>
    expectBlocked(
      runGate(validReport([]), ["--expect-run-id", "  ", "--require-spec", "cypress/e2e/a.cy.js"]),
      "invalid-arguments"
    ));
}

function addHarnessCases(ctx) {
  const { test, runGate, validReport, specEntry, passTest, expectBlocked, assert } = ctx;
  test("stats missing required integer key blocks", () => {
    const report = validReport([specEntry("cypress/e2e/x.cy.js", [passTest("a")])]);
    delete report.stats.skipped;
    expectBlocked(runGate(report, ["--require-spec", "cypress/e2e/x.cy.js"]), "malformed-report");
  });
  test("stats with non-integer value blocks", () => {
    const report = validReport([specEntry("cypress/e2e/x.cy.js", [passTest("a")])]);
    report.stats.tests = "1";
    expectBlocked(runGate(report, ["--require-spec", "cypress/e2e/x.cy.js"]), "malformed-report");
  });
  test("stats with negative value blocks", () => {
    const report = validReport([specEntry("cypress/e2e/x.cy.js", [passTest("a")])]);
    report.stats.passes = -1;
    expectBlocked(runGate(report, ["--require-spec", "cypress/e2e/x.cy.js"]), "malformed-report");
  });
  test("harness does not echo raw report content when parsing fails", () => {
    const result = runGate('{"stats": {"tests": 1}}', []);
    expectBlocked(result, "malformed-report");
    const prefix = "FAIL[malformed-report]: ";
    const line = result.errors.find((entry) => entry.startsWith(prefix));
    assert.ok(line);
    assert.ok(JSON.parse(line.slice(prefix.length)));
  });
}

function addProvenanceFreshnessCases(ctx) {
  const { test, runGate, validReport, specEntry, passTest, expectBlocked, expectPassed } = ctx;
  test("stale report passes with a longer freshness window", () => {
    const report = validReport([specEntry("cypress/e2e/x.cy.js", [passTest("a")])]);
    const start = new Date(Date.now() - 12 * 60 * 1000).toISOString();
    report.stats.start = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    report.stats.end = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    expectPassed(
      runGate(report, [
        "--max-report-age-minutes",
        "20",
        "--expect-run-id",
        "run-1",
        "--run-started-at",
        start,
        "--require-spec",
        "cypress/e2e/x.cy.js"
      ])
    );
  });
  test("missing --expect-run-id blocks", () =>
    expectBlocked(
      runGate(validReport([specEntry("cypress/e2e/x.cy.js", [passTest("a")])]), [
        "--require-spec",
        "cypress/e2e/x.cy.js"
      ]),
      "missing-run-identity"
    ));
  test("run identity mismatch blocks", () =>
    expectBlocked(
      runGate(validReport([specEntry("cypress/e2e/x.cy.js", [passTest("a")])], "run-OLD"), [
        "--expect-run-id",
        "run-NEW"
      ]),
      "run-identity-mismatch"
    ));
}

function addProvenanceEdgeCases(ctx) {
  const { test, runGate, validReport, specEntry, passTest, expectBlocked } = ctx;
  test("report without a finish timestamp blocks", () => {
    const report = validReport([specEntry("cypress/e2e/x.cy.js", [passTest("a")])]);
    delete report.stats.end;
    expectBlocked(
      runGate(report, ["--require-spec", "cypress/e2e/x.cy.js"]),
      "missing-freshness-timestamp"
    );
  });
  test("release gating requires a nonempty spec inventory", () => {
    const report = validReport([specEntry("cypress/e2e/x.cy.js", [passTest("a")])]);
    expectBlocked(
      runGate(report, ["--expect-run-id", "run-1"], true),
      "missing-required-spec-inventory"
    );
  });
}

module.exports = function registerAdditionalCases(ctx) {
  addTimeBoundaryCases(ctx);
  addArgumentCases(ctx);
  addHarnessCases(ctx);
  addProvenanceFreshnessCases(ctx);
  addProvenanceEdgeCases(ctx);
  registerAdditionalProvenanceCases(ctx);
  registerSkillCaseSet(ctx);
};
