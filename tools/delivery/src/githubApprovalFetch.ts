import {
  type ApprovalInputs,
  type CheckRun,
  type PullRequestReview,
  type RequiredCheckIdentity
} from "./copilotApprovalGate.js";
import { isCopilotReviewer } from "./copilotApprovalEvaluator.js";
import { toCheckRuns, toPullRequest, toReviews, toThreads } from "./githubApprovalParsers.js";

type RepositoryRef = { owner: string; repo: string };

async function responseJson(response: Response): Promise<unknown> {
  try {
    const payload: unknown = await response.json();
    return payload;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("GitHub returned invalid JSON.");
    throw error;
  }
}

async function githubGet(token: string, url: string): Promise<unknown> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });
  if (!response.ok) {
    throw new Error(`GitHub REST request failed: status=${response.status} url=${url}`);
  }
  return responseJson(response);
}

async function githubGraphQl(
  token: string,
  query: string,
  variables: Record<string, unknown>
): Promise<unknown> {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body: JSON.stringify({ query, variables })
  });
  if (!response.ok) {
    throw new Error(`GitHub GraphQL request failed: status=${response.status}`);
  }
  return responseJson(response);
}

async function paginate<T extends { id: number }>(
  requestPage: (page: number) => Promise<T[]>
): Promise<T[]> {
  const entries: T[] = [];
  const identities = new Set<number>();
  for (let page = 1; page <= 20; page += 1) {
    const chunk = await requestPage(page);
    for (const item of chunk) {
      if (identities.has(item.id)) throw new Error("GitHub pagination repeated an identity.");
      identities.add(item.id);
    }
    entries.push(...chunk);
    if (chunk.length < 100) return entries;
  }
  throw new Error("GitHub pagination exceeded the complete-coverage limit.");
}

async function fetchOpenPullRequest(
  token: string,
  repoRef: RepositoryRef,
  number: number
): Promise<{ number: number; headSha: string }> {
  const payload = await githubGet(
    token,
    `https://api.github.com/repos/${repoRef.owner}/${repoRef.repo}/pulls/${number}`
  );
  const pullRequest = toPullRequest(payload);
  if (pullRequest.number !== number) throw new Error("GitHub returned a different pull request.");
  if (pullRequest.requestedReviewers.some(isCopilotReviewer)) {
    throw new Error("Copilot re-review is still requested.");
  }
  return { number, headSha: pullRequest.headSha };
}

async function fetchReviews(token: string, repoRef: RepositoryRef, number: number) {
  return paginate<PullRequestReview>(async (page) => {
    const payload = await githubGet(
      token,
      `https://api.github.com/repos/${repoRef.owner}/${repoRef.repo}/pulls/${number}/reviews?per_page=100&page=${page}`
    );
    return toReviews(payload);
  });
}

async function fetchCheckRuns(token: string, repoRef: RepositoryRef, headSha: string) {
  return paginate<CheckRun>(async (page) => {
    const response = await githubGet(
      token,
      `https://api.github.com/repos/${repoRef.owner}/${repoRef.repo}/commits/${headSha}/check-runs?per_page=100&page=${page}`
    );
    return toCheckRuns(response);
  });
}

async function fetchReviewThreads(token: string, repoRef: RepositoryRef, number: number) {
  const threads: ApprovalInputs["reviewThreads"] = [];
  let cursor: string | null = null;
  const cursors = new Set<string>();
  const identities = new Set<string>();
  for (let page = 0; page < 20; page += 1) {
    const payload = await githubGraphQl(
      token,
      `query($owner:String!, $repo:String!, $number:Int!, $cursor:String) {
        repository(owner:$owner, name:$repo) {
          pullRequest(number:$number) {
            reviewThreads(first:100, after:$cursor) {
              nodes { id isResolved isOutdated }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }`,
      { owner: repoRef.owner, repo: repoRef.repo, number, cursor }
    );
    const pageThreads = toThreads(payload);
    for (const thread of pageThreads.threads) {
      if (identities.has(thread.id)) throw new Error("GitHub repeated a review-thread identity.");
      identities.add(thread.id);
    }
    threads.push(...pageThreads.threads);
    if (!pageThreads.hasNextPage) return threads;
    if (cursors.has(pageThreads.nextCursor)) throw new Error("GitHub repeated a thread cursor.");
    cursors.add(pageThreads.nextCursor);
    cursor = pageThreads.nextCursor;
  }
  throw new Error("GitHub review threads exceeded the complete-coverage limit.");
}

export async function buildApprovalInput(
  token: string,
  repoRef: RepositoryRef,
  pullNumber: number,
  requiredChecks: RequiredCheckIdentity[]
): Promise<ApprovalInputs> {
  const pullRequest = await fetchOpenPullRequest(token, repoRef, pullNumber);
  const [reviews, checkRuns, reviewThreads] = await Promise.all([
    fetchReviews(token, repoRef, pullRequest.number),
    fetchCheckRuns(token, repoRef, pullRequest.headSha),
    fetchReviewThreads(token, repoRef, pullRequest.number)
  ]);
  const latest = await fetchOpenPullRequest(token, repoRef, pullNumber);
  if (latest.headSha !== pullRequest.headSha) {
    throw new Error("Pull request head changed while collecting approval evidence.");
  }
  return {
    headSha: pullRequest.headSha,
    reviews,
    checkRuns: checkRuns.filter((checkRun) => checkRun.headSha === pullRequest.headSha),
    reviewThreads,
    requiredChecks
  };
}
