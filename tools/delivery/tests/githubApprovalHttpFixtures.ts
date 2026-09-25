export type MockHandler = (url: string) => Response;

export function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

export function firstPageReviews(): Array<Record<string, unknown>> {
  return Array.from({ length: 100 }, (_, index) => ({
    id: index + 1,
    state: "COMMENTED",
    submitted_at: new Date(Date.UTC(2026, 8, 24, 20, 0, index)).toISOString(),
    commit_id: "abc123",
    user: { login: `commenter-${index}` }
  }));
}

function resolvedThread(): Response {
  return response({
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: [{ id: "thread-1", isResolved: true, isOutdated: false }],
            pageInfo: { hasNextPage: false, endCursor: null }
          }
        }
      }
    }
  });
}

function passedCheck(headSha: string): Response {
  return response({
    check_runs: [
      {
        id: 1,
        name: "delivery-controls",
        head_sha: headSha,
        status: "completed",
        conclusion: "success",
        app: { slug: "github-actions" },
        started_at: "2026-09-24T20:00:00Z",
        completed_at: "2026-09-24T20:01:00Z"
      }
    ]
  });
}

export function freshHeadHandler(calls: string[]): MockHandler {
  return (url) => {
    calls.push(url);
    if (url.endsWith("/pulls/17")) {
      return response({
        number: 17,
        state: "open",
        draft: false,
        head: { sha: "fresh-head" },
        requested_reviewers: []
      });
    }
    if (url.includes("/pulls/17/reviews?")) {
      return response([
        {
          id: 1,
          state: "APPROVED",
          submitted_at: "2026-09-24T20:00:00Z",
          commit_id: "fresh-head",
          user: { login: "copilot-pull-request-reviewer[bot]" }
        }
      ]);
    }
    if (url.includes("/commits/fresh-head/check-runs?")) return passedCheck("fresh-head");
    if (url === "https://api.github.com/graphql") return resolvedThread();
    return response({}, 404);
  };
}

function finalReviewPage(): Response {
  return response([
    {
      id: 101,
      state: "CHANGES_REQUESTED",
      submitted_at: "2026-09-24T21:00:00Z",
      commit_id: "abc123",
      user: { login: "alice" }
    },
    {
      id: 102,
      state: "APPROVED",
      submitted_at: "2026-09-24T21:01:00Z",
      commit_id: "abc123",
      user: { login: "alice" }
    },
    {
      id: 103,
      state: "APPROVED",
      submitted_at: "2026-09-24T21:02:00Z",
      commit_id: "abc123",
      user: { login: "copilot-pull-request-reviewer[bot]" }
    }
  ]);
}

export function paginatedReviewHandler(): MockHandler {
  return (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/pulls/23")) {
      return response({
        number: 23,
        state: "open",
        draft: false,
        head: { sha: "abc123" },
        requested_reviewers: []
      });
    }
    if (parsed.pathname.endsWith("/pulls/23/reviews")) {
      return parsed.searchParams.get("page") === "1"
        ? response(firstPageReviews())
        : finalReviewPage();
    }
    if (parsed.pathname.endsWith("/commits/abc123/check-runs")) return passedCheck("abc123");
    if (url === "https://api.github.com/graphql") return resolvedThread();
    return response({}, 404);
  };
}
