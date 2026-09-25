"use strict";

const fs = require("fs");
const { gateError, parseTimestampIso } = require("./gate-shared.cjs");

function readLines(file) {
  let content;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch (_error) {
    throw gateError("invalid-arguments", "cannot read require-spec file: " + String(file));
  }
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function requireNonemptyValue(option, value, message) {
  if (typeof value !== "string" || !value.trim()) {
    throw gateError("invalid-arguments", option + " " + message);
  }
  return value;
}

function parseAgeOption(option, value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw gateError("invalid-arguments", option + " requires a nonnegative integer value");
  }
  const parsed = parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) {
    throw gateError("invalid-arguments", option + " exceeds the safe integer range");
  }
  return parsed;
}

function applyRequireSpecFile(options, value) {
  requireNonemptyValue("--require-spec-file", value, "requires a file path");
  options.requireSpec.push(...readLines(value));
}

function applyRunStartedAt(options, value) {
  if (parseTimestampIso(value, "run start").error) {
    throw gateError("invalid-arguments", "--run-started-at requires a canonical UTC ISO timestamp");
  }
  options.runStartedAt = value;
}

const HANDLERS = {
  "--max-report-age-minutes": (options, value) => {
    options.maxReportAgeMinutes = parseAgeOption("--max-report-age-minutes", value);
  },
  "--require-spec": (options, value) => {
    options.requireSpec.push(
      requireNonemptyValue("--require-spec", value, "requires a nonempty value")
    );
  },
  "--require-spec-file": applyRequireSpecFile,
  "--require-test": (options, value) => {
    options.requireTest.push(
      requireNonemptyValue("--require-test", value, "requires a nonempty fullTitle")
    );
  },
  "--expect-run-id": (options, value) => {
    options.expectRunId = requireNonemptyValue(
      "--expect-run-id",
      value,
      "requires a nonempty value"
    );
  },
  "--expect-revision": (options, value) => {
    if (typeof value !== "string" || !/^[0-9a-f]{40}$/i.test(value)) {
      throw gateError("invalid-arguments", "--expect-revision requires a full commit SHA");
    }
    options.expectRevision = value;
  },
  "--run-started-at": applyRunStartedAt
};

function parseArgs(argv) {
  const options = {
    report: null,
    maxReportAgeMinutes: 60,
    requireSpec: [],
    requireTest: [],
    expectRunId: undefined,
    expectRevision: undefined,
    runStartedAt: undefined
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      if (options.report === null) {
        options.report = arg;
        continue;
      }
      throw gateError("invalid-arguments", "unexpected positional argument: " + String(arg));
    }
    const handler = HANDLERS[arg];
    if (!handler) {
      throw gateError("invalid-arguments", "unknown option: " + String(arg));
    }
    i += 1;
    handler(options, argv[i]);
  }
  if (!options.report) {
    throw gateError("usage", "no report path provided");
  }
  return options;
}

module.exports = { parseArgs };
