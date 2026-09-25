"use strict";

const {
  gateError,
  collectTestEntries,
  collectTestsRecursive,
  assertValidTestState,
  testExecutable,
  testPassed,
  specExecutableTestCount,
  specFileMatches
} = require("./gate-shared.cjs");
const {
  validateRunWindow,
  validateFreshness,
  validateRunIdentity,
  validateRevision,
  validateRequiredInventory
} = require("./gate-validation-provenance.cjs");

const RECONCILED_STATS_KEYS = ["tests", "passes", "pending", "failures", "skipped"];
const REQUIRED_STATS_KEYS = ["tests", "passes", "pending", "failures", "skipped"];

function validateRequiredSpecs(report, requiredSpecs) {
  const problems = [];
  for (const required of requiredSpecs) {
    const matched = report.results.find((spec) => specFileMatches(spec, required));
    if (!matched) problems.push(gateError("missing-required-spec", required));
    else if (specExecutableTestCount(matched) === 0)
      problems.push(gateError("required-spec-without-executable-tests", required));
  }
  return problems;
}

function validateRequiredTests(report, requiredTests) {
  const byTitle = new Map();
  for (const entry of collectTestEntries(report)) addTitleEntry(byTitle, entry);
  const problems = [];
  for (const required of requiredTests) {
    const matches = byTitle.get(required) || [];
    if (matches.length === 0) problems.push(gateError("missing-required-test", required));
    else if (!hasPassingMatch(matches))
      problems.push(gateError("required-test-not-passing", required));
  }
  return problems;
}

function addTitleEntry(index, entry) {
  const key =
    typeof entry.test.fullTitle === "string" && entry.test.fullTitle
      ? entry.test.fullTitle
      : entry.test.title;
  if (!index.has(key)) index.set(key, []);
  index.get(key).push(entry);
}

function hasPassingMatch(matches) {
  return matches.some((entry) => testExecutable(entry.test) && testPassed(entry.test));
}

function validateDisabledFlags(report) {
  const problems = environmentDisableProblems(report);
  const fromEntries = disabledEntryProblems(report);
  problems.push(...fromEntries.problems);
  let disabledCount = fromEntries.count;
  if (report.stats && report.stats.disabled)
    disabledCount = appendDisabledStatProblem(problems, report, disabledCount);
  if (disabledCount > 0) problems.push(gateError("disabled-tests-total", String(disabledCount)));
  return problems;
}

function environmentDisableProblems(report) {
  const problems = [];
  if (process.env.USER_DISABLE_TESTS) {
    problems.push(gateError("disabled-tests-flag", "USER_DISABLE_TESTS set in gate environment"));
  }
  const env = report.env || {};
  if (isRecord(env)) {
    appendDisableEnvProblems(problems, env);
  } else if (env) {
    problems.push(gateError("malformed-report", "report env must be an object when present"));
  }
  return problems;
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function appendDisableEnvProblems(problems, env) {
  for (const key of Object.keys(env)) {
    const disabled = /disable.*test|test.*disable/i.test(key) && env[key];
    if (disabled) {
      problems.push(gateError("disabled-tests-flag", "report env " + key + "=" + String(env[key])));
    }
  }
}

function disabledEntryProblems(report) {
  const problems = [];
  let count = 0;
  for (const spec of report.results) {
    const entries = [];
    collectTestsRecursive(spec, spec, entries);
    for (const entry of entries) {
      if (entry.test.disabled !== true) continue;
      count++;
      const label =
        (spec.file || "<no-file>") + " :: " + (entry.test.fullTitle || entry.test.title);
      problems.push(gateError("disabled-tests-flag", label));
    }
  }
  return { count, problems };
}

function appendDisabledStatProblem(problems, report, count) {
  const updated = count + report.stats.disabled;
  const detail =
    "report stats.enabled=" +
    String(report.stats.enabled) +
    " but individual disabled tests are present (count=" +
    String(updated) +
    ")";
  problems.push(gateError("disabled-tests-flag", detail));
  return updated;
}

function countObservedStates(entries, problems) {
  const actual = { tests: entries.length, passes: 0, pending: 0, failures: 0, skipped: 0 };
  for (const entry of entries) {
    try {
      assertValidTestState(entry.test, entry.spec.file);
    } catch (error) {
      problems.push(error);
      continue;
    }
    if (entry.test.state === "passed") actual.passes++;
    else if (entry.test.state === "failed") actual.failures++;
    else if (entry.test.state === "pending") actual.pending++;
    else if (entry.test.state === "skipped") actual.skipped++;
  }
  return actual;
}

function validateStatFields(stats) {
  const problems = [];
  for (const key of REQUIRED_STATS_KEYS) {
    if (!Number.isInteger(stats[key]) || stats[key] < 0) {
      problems.push(
        gateError("malformed-report", "stats." + key + " must be a nonnegative integer")
      );
    }
  }
  return problems;
}

function validateStatsReconciliation(report) {
  const problems = validateStatFields(report.stats);
  if (problems.length > 0) return problems;

  const entries = collectTestEntries(report);
  const actual = countObservedStates(entries, problems);
  for (const key of RECONCILED_STATS_KEYS) {
    if (report.stats[key] !== actual[key])
      problems.push(
        gateError(
          "inconsistent-stats",
          "stats." +
            key +
            "=" +
            String(report.stats[key]) +
            " but " +
            String(actual[key]) +
            " observed"
        )
      );
  }
  if (
    typeof report.stats.hasSkipped === "boolean" &&
    report.stats.hasSkipped !== report.stats.skipped > 0
  ) {
    problems.push(gateError("inconsistent-stats", "hasSkipped disagrees with skipped"));
  }
  return problems;
}

function validate(report, options, isReleaseGate) {
  const entries = collectTestEntries(report);
  const executed = entries.filter((entry) => testExecutable(entry.test));
  const passing = executed.filter((entry) => testPassed(entry.test));
  const skippedCount = entries.length - executed.length;
  const problems = [];
  if (report.results.length === 0) {
    problems.push(gateError("empty-scope", "report has no result specs"));
  }
  if (entries.length === 0)
    problems.push(gateError("zero-tests", "no test cases present in any spec"));
  if (executed.length === 0)
    problems.push(gateError("zero-executed-tests", "all tests pending/skipped"));
  else if (passing.length !== executed.length)
    problems.push(
      gateError(
        "test-failures",
        String(executed.length - passing.length) + " executed test(s) did not pass"
      )
    );
  if (skippedCount > 0)
    problems.push(
      gateError(
        "skipped-tests",
        String(skippedCount) + " test(s) pending/skipped (AC-10: skipped tests block delivery)"
      )
    );
  problems.push(...validateStatsReconciliation(report));
  problems.push(...validateRequiredSpecs(report, options.requireSpec));
  problems.push(...validateRequiredTests(report, options.requireTest));
  problems.push(...validateDisabledFlags(report));
  problems.push(...validateFreshness(report, options.maxReportAgeMinutes, options.runStartedAt));
  problems.push(...validateRunIdentity(report, options.expectRunId));
  problems.push(...validateRevision(report, options.expectRevision));
  problems.push(...validateRequiredInventory(options, isReleaseGate));
  return problems;
}

module.exports = {
  validateRequiredSpecs,
  validateRequiredTests,
  validateDisabledFlags,
  validateRunWindow,
  validateFreshness,
  validateStatsReconciliation,
  validateRunIdentity,
  validateRevision,
  validateRequiredInventory,
  validate,
  RECONCILED_STATS_KEYS,
  REQUIRED_STATS_KEYS
};
