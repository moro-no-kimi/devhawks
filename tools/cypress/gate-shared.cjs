"use strict";

const fs = require("fs");
const path = require("path");

const VALID_TEST_STATES = new Set(["passed", "failed", "pending", "skipped"]);

function gateError(reason, detail) {
  const err = new Error(detail === undefined ? reason : reason + ": " + detail);
  err.reason = reason;
  return err;
}

function parseObjectJson(raw) {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw gateError("malformed-report", "report must be a JSON object");
  }
  return parsed;
}

function assertReportShape(parsed) {
  if (!parsed.stats || typeof parsed.stats !== "object" || Array.isArray(parsed.stats)) {
    throw gateError("malformed-report", "report missing valid 'stats' object");
  }
  if (!Array.isArray(parsed.results)) {
    throw gateError("malformed-report", "report 'results' must be an array");
  }
}

function parseReport(reportPath) {
  let raw;
  try {
    raw = fs.readFileSync(reportPath, "utf8");
  } catch (error) {
    throw gateError(
      "missing-report",
      "cannot read report: " + reportPath + " (" + (error.code || "read-failed") + ")"
    );
  }

  let parsed;
  try {
    parsed = parseObjectJson(raw);
  } catch (error) {
    if (error && error.reason) {
      throw error;
    }
    throw gateError("malformed-report", "report is not valid JSON");
  }
  assertReportShape(parsed);
  return parsed;
}

function assertSpecObject(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw gateError("malformed-report", "non-object spec entry in results");
  }
}

function assertTestObject(test, spec) {
  const valid =
    test && typeof test === "object" && !Array.isArray(test) && typeof test.title === "string";
  if (!valid) {
    throw gateError(
      "malformed-report",
      "malformed test entry in spec: " + (spec.file || "<no-file>")
    );
  }
}

function assertSuiteObject(suite, spec) {
  if (!suite || typeof suite !== "object" || Array.isArray(suite)) {
    throw gateError(
      "malformed-report",
      "malformed suites entry in spec: " + (spec.file || "<no-file>")
    );
  }
}

function collectTestsRecursive(node, spec, out) {
  if (!Array.isArray(node.tests) || !Array.isArray(node.suites)) {
    throw gateError("malformed-report", "every report node must contain tests and suites arrays");
  }
  for (const test of node.tests) {
    assertTestObject(test, spec);
    out.push({ spec: spec, test: test });
  }

  for (const suite of node.suites) {
    assertSuiteObject(suite, spec);
    collectTestsRecursive(suite, spec, out);
  }
}

function collectTestEntries(report) {
  const entries = [];
  for (const spec of report.results) {
    assertSpecObject(spec);
    collectTestsRecursive(spec, spec, entries);
  }
  return entries;
}

function assertBooleanFlags(test, where) {
  const required = ["pass", "fail", "pending", "skipped"];
  const invalid = required.some((key) => typeof test[key] !== "boolean");
  if (invalid) {
    throw gateError(
      "malformed-test-state",
      where + " (missing boolean flags pass/fail/pending/skipped)"
    );
  }
}

function assertStateFlag(test, where, key, expected) {
  if (test[key] !== expected) {
    throw gateError(
      "malformed-test-state",
      where + " (" + key + " flag contradicts state=" + test.state + ")"
    );
  }
}

function assertValidTestState(test, specName) {
  const where = (specName || "<no-file>") + " :: " + (test.fullTitle || test.title);
  if (typeof test.state !== "string" || !VALID_TEST_STATES.has(test.state)) {
    throw gateError(
      "malformed-test-state",
      where + " (unknown state=" + JSON.stringify(test.state) + ")"
    );
  }
  assertBooleanFlags(test, where);
  assertStateFlag(test, where, "pass", test.state === "passed");
  assertStateFlag(test, where, "fail", test.state === "failed");
  assertStateFlag(test, where, "pending", test.state === "pending");
  assertStateFlag(test, where, "skipped", test.state === "skipped");
  if (test.disabled === true && test.state === "passed") {
    throw gateError("malformed-test-state", where + " (disabled=true together with state=passed)");
  }
}

function testExecutable(test) {
  return test.state === "passed" || test.state === "failed";
}

function testPassed(test) {
  return test.state === "passed" && test.pass === true && test.fail === false;
}

function specExecutableTestCount(spec) {
  const entries = [];
  collectTestsRecursive(spec, spec, entries);
  return entries.filter((entry) => testExecutable(entry.test)).length;
}

function specFileMatches(spec, required) {
  const candidates = [spec.file, spec.fullFile].filter(
    (value) => typeof value === "string" && value.length > 0
  );
  if (candidates.length === 0) return false;
  if (candidates.includes(required)) return true;

  for (const candidate of candidates) {
    try {
      if (path.resolve(candidate) === path.resolve(required)) return true;
    } catch (_error) {
      return false;
    }
  }
  return false;
}

function parseTimestampIso(value, label) {
  if (typeof value !== "string") {
    return { error: gateError("malformed-report", label + " timestamp must be a UTC ISO string") };
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return { error: gateError("malformed-report", label + " timestamp is unparseable") };
  }
  const canonical = parsed.toISOString();
  if (value !== canonical && value !== canonical.replace(".000Z", "Z")) {
    return { error: gateError("malformed-report", label + " timestamp is not canonical UTC ISO") };
  }
  return { value: parsed };
}

module.exports = {
  gateError,
  parseReport,
  collectTestsRecursive,
  collectTestEntries,
  assertValidTestState,
  testExecutable,
  testPassed,
  specExecutableTestCount,
  specFileMatches,
  parseTimestampIso
};
