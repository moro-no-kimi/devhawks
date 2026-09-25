export type PullRequestReview = {
  id: number;
  state: string;
  submittedAt: string;
  commitId: string | null;
  userLogin: string;
};

export type CheckRun = {
  id: number;
  name: string;
  headSha: string;
  status: string;
  conclusion: string | null;
  appSlug: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type ReviewThread = {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
};

export type RequiredCheckIdentity = {
  name: string;
  appSlug: string;
};

export type ApprovalInputs = {
  headSha: string;
  reviews: PullRequestReview[];
  checkRuns: CheckRun[];
  reviewThreads: ReviewThread[];
  requiredChecks: RequiredCheckIdentity[];
};

export type Evaluation = {
  ok: boolean;
  errors: string[];
};

const COPILOT_APPROVERS = new Set(["copilot-pull-request-reviewer[bot]"]);

const SUPPORTED_REVIEW_STATES = new Set([
  "APPROVED",
  "CHANGES_REQUESTED",
  "COMMENTED",
  "DISMISSED"
]);

export function isCopilotReviewer(login: string): boolean {
  return COPILOT_APPROVERS.has(login.toLowerCase());
}

function normalizeState(value: string): string {
  return value.trim().toUpperCase();
}

function latestReviewByUser(reviews: PullRequestReview[]): Map<string, PullRequestReview> {
  const latest = new Map<string, PullRequestReview>();
  const sorted = [...reviews].sort(
    (left, right) =>
      Date.parse(left.submittedAt) - Date.parse(right.submittedAt) || left.id - right.id
  );
  for (const review of sorted) {
    latest.set(review.userLogin.toLowerCase(), review);
  }
  return latest;
}

function hasCurrentHeadCopilotApproval(
  latestReviews: Map<string, PullRequestReview>,
  headSha: string
): boolean {
  for (const [userLogin, review] of latestReviews.entries()) {
    if (!isCopilotReviewer(userLogin)) {
      continue;
    }
    if (normalizeState(review.state) !== "APPROVED") {
      continue;
    }
    if (review.commitId === headSha) {
      return true;
    }
  }
  return false;
}

function reviewStateErrors(latestReviews: Map<string, PullRequestReview>): string[] {
  const errors: string[] = [];
  for (const review of latestReviews.values()) {
    const state = normalizeState(review.state);
    if (!SUPPORTED_REVIEW_STATES.has(state)) {
      errors.push(`Unsupported review state encountered: ${state}`);
      continue;
    }
    if (state === "CHANGES_REQUESTED") {
      errors.push("A latest-effective changes-requested review is still present.");
    }
  }
  return errors;
}

function unresolvedThreadErrors(threads: ReviewThread[]): string[] {
  const actionable = threads.filter((thread) => !thread.isResolved);
  return actionable.length > 0
    ? [`Unresolved actionable review threads: ${actionable.length}`]
    : [];
}

function requiredCheckErrors(
  checkRuns: CheckRun[],
  requiredChecks: RequiredCheckIdentity[],
  headSha: string
): string[] {
  const errors: string[] = [];
  for (const check of requiredChecks) {
    const candidates = checkRuns
      .filter(
        (run) => run.name === check.name && run.appSlug === check.appSlug && run.headSha === headSha
      )
      .sort((left, right) => right.id - left.id);
    if (candidates.length === 0) {
      errors.push(`Missing required check run identity: ${check.appSlug}/${check.name}`);
      continue;
    }
    const latest = candidates[0];
    const status = latest.status.toLowerCase();
    const conclusion = (latest.conclusion ?? "").toLowerCase();
    if (status !== "completed" || conclusion !== "success") {
      errors.push(
        `Required check not successful for ${check.appSlug}/${check.name}: status=${status} conclusion=${conclusion || "null"}`
      );
    }
  }
  return errors;
}

export function evaluateCopilotApproval(inputs: ApprovalInputs): Evaluation {
  const latestReviews = latestReviewByUser(inputs.reviews);
  const errors: string[] = [];
  if (inputs.requiredChecks.length === 0) {
    errors.push("Required check inventory is empty.");
  }
  if (!hasCurrentHeadCopilotApproval(latestReviews, inputs.headSha)) {
    errors.push("No Copilot approval exists for the current head commit.");
  }
  errors.push(...reviewStateErrors(latestReviews));
  errors.push(...unresolvedThreadErrors(inputs.reviewThreads));
  errors.push(...requiredCheckErrors(inputs.checkRuns, inputs.requiredChecks, inputs.headSha));
  return { ok: errors.length === 0, errors };
}
