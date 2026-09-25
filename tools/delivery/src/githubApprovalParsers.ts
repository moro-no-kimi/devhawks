import { type CheckRun, type PullRequestReview, type ReviewThread } from "./copilotApprovalGate.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Missing or malformed GitHub ${label}.`);
  return value;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Missing or malformed GitHub ${label}.`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing or malformed GitHub ${label}.`);
  }
  return value;
}

function nullableText(value: unknown, label: string): string | null {
  return value === null ? null : text(value, label);
}

function positiveId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Invalid GitHub numeric identity.");
  }
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`Invalid GitHub ${label}.`);
  return value;
}

function timestamp(value: unknown, label: string): string {
  const result = text(value, label);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`Invalid GitHub ${label}.`);
  return result;
}

function nullableTimestamp(value: unknown, label: string): string | null {
  return value === null ? null : timestamp(value, label);
}

function reviewerLogin(value: unknown): string {
  return text(record(value, "reviewer").login, "reviewer login");
}

export function toPullRequest(input: unknown): {
  number: number;
  headSha: string;
  requestedReviewers: string[];
} {
  const payload = record(input, "pull request");
  if (payload.state !== "open" || payload.draft !== false) {
    throw new Error("Pull request is not open and non-draft.");
  }
  return {
    number: positiveId(payload.number),
    headSha: text(record(payload.head, "head").sha, "head SHA"),
    requestedReviewers: array(payload.requested_reviewers, "requested reviewers").map(reviewerLogin)
  };
}

function toReview(input: unknown): PullRequestReview {
  const review = record(input, "review");
  return {
    id: positiveId(review.id),
    state: text(review.state, "review state"),
    submittedAt: timestamp(review.submitted_at, "submitted review timestamp"),
    commitId: nullableText(review.commit_id, "review commit"),
    userLogin: reviewerLogin(review.user)
  };
}

export function toReviews(input: unknown): PullRequestReview[] {
  return array(input, "review list").map(toReview);
}

function toCheckRun(input: unknown): CheckRun {
  const run = record(input, "check run");
  return {
    id: positiveId(run.id),
    name: text(run.name, "check name"),
    headSha: text(run.head_sha, "check SHA"),
    status: text(run.status, "check status"),
    conclusion: nullableText(run.conclusion, "check conclusion"),
    appSlug: text(record(run.app, "check app").slug, "check app slug"),
    startedAt: nullableTimestamp(run.started_at, "check start"),
    completedAt: nullableTimestamp(run.completed_at, "check completion")
  };
}

export function toCheckRuns(input: unknown): CheckRun[] {
  return array(record(input, "check response").check_runs, "check list").map(toCheckRun);
}

function toThread(value: unknown): ReviewThread {
  const node = record(value, "review thread");
  return {
    id: text(node.id, "thread identity"),
    isResolved: boolean(node.isResolved, "thread resolution"),
    isOutdated: boolean(node.isOutdated, "thread location state")
  };
}

type ThreadPage =
  | { threads: ReviewThread[]; hasNextPage: true; nextCursor: string }
  | { threads: ReviewThread[]; hasNextPage: false; nextCursor: string | null };

export function toThreads(input: unknown): ThreadPage {
  const payload = record(input, "GraphQL response");
  if (payload.errors !== undefined && array(payload.errors, "GraphQL errors").length > 0) {
    throw new Error("GitHub review-thread query returned GraphQL errors.");
  }
  const data = record(payload.data, "GraphQL data");
  const repository = record(data.repository, "GraphQL repository");
  const pullRequest = record(repository.pullRequest, "GraphQL pull request");
  const result = record(pullRequest.reviewThreads, "review-thread connection");
  const threads = array(result.nodes, "review-thread nodes").map(toThread);
  const page = record(result.pageInfo, "review-thread page info");
  const hasNextPage = boolean(page.hasNextPage, "next-page indicator");
  const nextCursor = nullableText(page.endCursor, "review-thread cursor");
  if (hasNextPage) {
    if (nextCursor === null) throw new Error("GitHub omitted a required next-page cursor.");
    return { threads, hasNextPage: true, nextCursor };
  }
  return { threads, hasNextPage: false, nextCursor };
}
