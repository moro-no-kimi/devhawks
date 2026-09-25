#!/usr/bin/env node
"use strict";

const { parseArgs } = require("./gate-args.cjs");
const {
  gateError,
  parseReport,
  collectTestEntries,
  collectTestsRecursive,
  assertValidTestState,
  testExecutable,
  testPassed,
  specFileMatches,
  parseTimestampIso
} = require("./gate-shared.cjs");
const {
  validateRequiredSpecs,
  validateRequiredTests,
  validateDisabledFlags,
  validateStatsReconciliation,
  validateRunIdentity,
  validateRevision,
  validateRunWindow,
  validateRequiredInventory,
  validateFreshness,
  validate,
  RECONCILED_STATS_KEYS,
  REQUIRED_STATS_KEYS
} = require("./gate-validation.cjs");

function fail(label, detail) {
  console.error(
    "FAIL[" + label + "]: " + JSON.stringify(String(detail === undefined ? label : detail))
  );
  process.exitCode = 1;
}

function resultsSummary(report, options) {
  const parts = [
    String(report.results.length) + " spec(s)",
    String(report.stats.passes) + " passed"
  ];
  parts.push("fresh within " + String(options.maxReportAgeMinutes) + " minute(s)");
  parts.push("run, revision, and invocation window matched");
  return parts.join(", ");
}

function run(argv, isReleaseGate) {
  let options;
  let report;
  try {
    options = parseArgs(argv);
    report = parseReport(options.report);
  } catch (error) {
    fail(error.reason || "error", error.message);
    return;
  }

  const problems = validate(report, options, isReleaseGate !== false);
  if (problems.length > 0) {
    for (const error of problems) {
      fail(error.reason || "error", error.message);
    }
    console.error("BLOCKED");
    return;
  }
  console.log("PASS: " + resultsSummary(report, options));
}

module.exports.gateError = gateError;
module.exports.parseReport = parseReport;
module.exports.collectTestEntries = collectTestEntries;
module.exports.collectTestsRecursive = collectTestsRecursive;
module.exports.assertValidTestState = assertValidTestState;
module.exports.testExecutable = testExecutable;
module.exports.testPassed = testPassed;
module.exports.specFileMatches = specFileMatches;
module.exports.validateRequiredSpecs = validateRequiredSpecs;
module.exports.validateRequiredTests = validateRequiredTests;
module.exports.validateDisabledFlags = validateDisabledFlags;
module.exports.validateStatsReconciliation = validateStatsReconciliation;
module.exports.validateRunIdentity = validateRunIdentity;
module.exports.validateRevision = validateRevision;
module.exports.validateRunWindow = validateRunWindow;
module.exports.validateRequiredInventory = validateRequiredInventory;
module.exports.validateFreshness = validateFreshness;
module.exports.validate = validate;
module.exports.parseArgs = parseArgs;
module.exports.run = run;
module.exports.parseTimestampIso = parseTimestampIso;
module.exports.RECONCILED_STATS_KEYS = RECONCILED_STATS_KEYS;
module.exports.REQUIRED_STATS_KEYS = REQUIRED_STATS_KEYS;

if (require.main === module) {
  run(process.argv.slice(2), true);
}
