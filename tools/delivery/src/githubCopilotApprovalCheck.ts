import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateCopilotApproval, type RequiredCheckIdentity } from "./copilotApprovalGate.js";
import { buildApprovalInput } from "./githubApprovalFetch.js";
import { logError, logInfo } from "./safeLog.js";

type EventPayload = {
  pull_request?: { number?: number };
  workflow_run?: { pull_requests?: Array<{ number?: number }> };
};
type RepositoryRef = { owner: string; repo: string };

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseRepository(raw: string): RepositoryRef {
  const [owner, repo] = raw.split("/");
  if (!owner || !repo) {
    throw new Error("GITHUB_REPOSITORY must use owner/repo format.");
  }
  return { owner, repo };
}

export function parseRequiredChecks(raw: string | undefined): RequiredCheckIdentity[] {
  if (!raw) {
    return [{ name: "delivery-controls", appSlug: "github-actions" }];
  }
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("REQUIRED_CHECKS_JSON must be a non-empty JSON array.");
  }
  return parsed.map((item) => {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as { name?: unknown }).name !== "string" ||
      typeof (item as { appSlug?: unknown }).appSlug !== "string"
    ) {
      throw new Error("Each REQUIRED_CHECKS_JSON entry must include string name and appSlug.");
    }
    return {
      name: (item as { name: string }).name,
      appSlug: (item as { appSlug: string }).appSlug
    };
  });
}

export function getCandidatePullRequestNumbers(event: EventPayload): number[] {
  const numbers = new Set<number>();
  if (typeof event.pull_request?.number === "number") {
    numbers.add(event.pull_request.number);
  }
  for (const pr of event.workflow_run?.pull_requests ?? []) {
    if (typeof pr.number === "number") {
      numbers.add(pr.number);
    }
  }
  return [...numbers];
}

export async function runGithubApprovalGate(): Promise<number> {
  const token = requireEnv("GITHUB_TOKEN");
  const eventPath = requireEnv("GITHUB_EVENT_PATH");
  const repository = parseRepository(requireEnv("GITHUB_REPOSITORY"));
  const requiredChecks = parseRequiredChecks(process.env.REQUIRED_CHECKS_JSON);
  const payload = JSON.parse(fs.readFileSync(eventPath, "utf-8")) as EventPayload;
  const pullNumbers = getCandidatePullRequestNumbers(payload);
  if (pullNumbers.length === 0) {
    logError("copilot-approval-gate-no-pr-context", {
      repository: `${repository.owner}/${repository.repo}`
    });
    return 2;
  }

  for (const pullNumber of pullNumbers) {
    const input = await buildApprovalInput(token, repository, pullNumber, requiredChecks);
    const result = evaluateCopilotApproval(input);
    if (!result.ok) {
      logError("copilot-approval-gate-fail", { pullNumber, errors: result.errors });
      return 1;
    }
  }

  logInfo("copilot-approval-gate-pass", { pullRequests: pullNumbers });
  return 0;
}

const isCliEntry =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCliEntry) {
  runGithubApprovalGate()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      logError("copilot-approval-gate-error", {
        message: error instanceof Error ? error.message : String(error)
      });
      process.exitCode = 2;
    });
}
