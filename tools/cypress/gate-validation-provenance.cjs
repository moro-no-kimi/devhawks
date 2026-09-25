"use strict";

const { gateError, parseTimestampIso } = require("./gate-shared.cjs");

function readCiObject(report) {
  if (!report.meta || typeof report.meta !== "object") return null;
  if (!report.meta.ci || typeof report.meta.ci !== "object") return null;
  return report.meta.ci;
}

function validateRunWindow(report, runStartedAt, finishedAt, now) {
  if (runStartedAt === undefined) {
    return [gateError("missing-run-start", "no --run-started-at supplied by the runner")];
  }
  const expected = parseTimestampIso(runStartedAt, "expected run start");
  const started = parseTimestampIso(report.stats.start, "report start");
  const errors = [expected.error, started.error].filter(Boolean);
  if (errors.length > 0) return errors;
  if (expected.value.getTime() > now)
    errors.push(gateError("future-run-start", "expected invocation start is in the future"));
  if (started.value.getTime() < expected.value.getTime())
    errors.push(gateError("report-before-run", "report started before the current invocation"));
  if (started.value.getTime() > finishedAt.getTime())
    errors.push(gateError("invalid-report-window", "report finishes before it starts"));
  return errors;
}

function validateFreshness(report, maxAgeMinutes, runStartedAt) {
  const finished = report.stats.end;
  if (!finished)
    return [gateError("missing-freshness-timestamp", "report has no finish/finished timestamp")];
  const parsed = parseTimestampIso(finished, "finish");
  if (parsed.error) return [parsed.error];
  const finishedAt = parsed.value;
  const now = Date.now();
  const problems = [];
  if (finishedAt.getTime() > now) {
    problems.push(
      gateError(
        "future-finish-timestamp",
        "report finish " + finishedAt.toISOString() + " is in the future"
      )
    );
  }
  if (now - finishedAt.getTime() > maxAgeMinutes * 60 * 1000) {
    problems.push(
      gateError(
        "stale-report",
        "older than max " + String(maxAgeMinutes) + " minutes; finish=" + finishedAt.toISOString()
      )
    );
  }
  problems.push(...validateRunWindow(report, runStartedAt, finishedAt, now));
  return problems;
}

function validateRunIdentity(report, expectRunId) {
  if (expectRunId === undefined)
    return [gateError("missing-run-identity", "no --expect-run-id supplied by CI")];
  const ci = readCiObject(report);
  if (!ci || typeof ci.runId !== "string" || !ci.runId)
    return [gateError("missing-run-identity", "report has no meta.ci.runId")];
  if (ci.runId !== expectRunId)
    return [
      gateError("run-identity-mismatch", "expected run id diverges from report-declared runId")
    ];
  return [];
}

function validateRevision(report, expectRevision) {
  if (expectRevision === undefined)
    return [gateError("missing-expected-revision", "no --expect-revision supplied by CI")];
  const ci = readCiObject(report);
  if (!ci || typeof ci.revision !== "string" || !ci.revision)
    return [gateError("malformed-revision", "report meta.ci.revision is not a full commit SHA")];
  const actual = ci.revision.toLowerCase();
  const expected = expectRevision.toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(actual))
    return [gateError("malformed-revision", "report meta.ci.revision is not a full commit SHA")];
  if (actual !== expected)
    return [
      gateError("revision-mismatch", "expected revision diverges from report-declared revision")
    ];
  return [];
}

function validateRequiredInventory(options, isReleaseGate) {
  if (!isReleaseGate) return [];
  if (Array.isArray(options.requireSpec) && options.requireSpec.length > 0) return [];
  return [
    gateError(
      "missing-required-spec-inventory",
      "release gating requires at least one --require-spec or --require-spec-file"
    )
  ];
}

module.exports = {
  validateRunWindow,
  validateFreshness,
  validateRunIdentity,
  validateRevision,
  validateRequiredInventory
};
