import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateCopilotApproval,
  type ApprovalInputs,
  type CheckRun,
  type Evaluation,
  type PullRequestReview,
  type RequiredCheckIdentity,
  type ReviewThread
} from "./copilotApprovalEvaluator.js";
import { logError, logInfo } from "./safeLog.js";

export {
  evaluateCopilotApproval,
  type ApprovalInputs,
  type CheckRun,
  type Evaluation,
  type PullRequestReview,
  type RequiredCheckIdentity,
  type ReviewThread
};

type CliOptions = { fixturePath?: string };

function parseCli(argv: string[]): CliOptions {
  const options: CliOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--fixture") {
      options.fixturePath = argv[index + 1];
      index += 1;
    }
  }
  return options;
}

function runFromFixture(fixturePath: string): number {
  const resolved = path.resolve(fixturePath);
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf-8")) as ApprovalInputs;
  const result = evaluateCopilotApproval(parsed);
  if (result.ok) {
    logInfo("copilot-approval-gate-pass");
    return 0;
  }
  logError("copilot-approval-gate-fail", { errors: result.errors });
  return 1;
}

const isCliEntry =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCliEntry) {
  const options = parseCli(process.argv.slice(2));
  if (!options.fixturePath) {
    logError("copilot-approval-gate-invalid-args", { message: "--fixture is required." });
    process.exitCode = 2;
  } else {
    process.exitCode = runFromFixture(options.fixturePath);
  }
}
