import { describe, expect, it } from "vitest";
import { toCheckRuns, toPullRequest, toReviews, toThreads } from "../src/githubApprovalParsers.js";

function threadResponse(nodes: unknown, pageInfo: unknown): unknown {
  return { data: { repository: { pullRequest: { reviewThreads: { nodes, pageInfo } } } } };
}

describe("GitHub response contracts", () => {
  it.each([null, {}, [], { data: null }, { data: { repository: null } }])(
    "does not turn an incomplete thread response into zero findings",
    (payload) => {
      expect(() => toThreads(payload)).toThrow(/GitHub/);
    }
  );

  it.each([
    { nodes: null, page: { hasNextPage: false, endCursor: null } },
    { nodes: [null], page: { hasNextPage: false, endCursor: null } },
    { nodes: [{ id: "t", isOutdated: false }], page: { hasNextPage: false, endCursor: null } },
    { nodes: [], page: null },
    { nodes: [], page: { endCursor: null } },
    { nodes: [], page: { hasNextPage: true, endCursor: null } }
  ])("rejects malformed thread nodes and pagination", ({ nodes, page }) => {
    expect(() => toThreads(threadResponse(nodes, page))).toThrow(/GitHub/);
  });

  it("accepts an explicitly complete empty thread connection", () => {
    expect(toThreads(threadResponse([], { hasNextPage: false, endCursor: null }))).toEqual({
      threads: [],
      hasNextPage: false,
      nextCursor: null
    });
  });

  it("preserves unresolved outdated threads for the evaluator", () => {
    const nodes = [{ id: "old-location", isResolved: false, isOutdated: true }];
    expect(toThreads(threadResponse(nodes, { hasNextPage: true, endCursor: "next" }))).toEqual({
      threads: nodes,
      hasNextPage: true,
      nextCursor: "next"
    });
  });

  it("does not drop a pending or malformed review record", () => {
    const review = {
      id: 1,
      state: "PENDING",
      submitted_at: null,
      commit_id: "head",
      user: { login: "copilot-pull-request-reviewer[bot]" }
    };
    expect(() => toReviews([review])).toThrow(/submitted review timestamp/);
  });

  it("does not treat a missing check list as an empty successful response", () => {
    expect(() => toCheckRuns({})).toThrow(/check list/);
  });

  it("requires explicit pending-review information on a pull request", () => {
    expect(() =>
      toPullRequest({
        number: 1,
        state: "open",
        draft: false,
        head: { sha: "head" }
      })
    ).toThrow(/requested reviewers/);
  });
});
