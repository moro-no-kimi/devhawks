import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApprovalInput } from "../src/githubApprovalFetch.js";

function threadPage(cursor: string, id: string, hasNextPage = true): Response {
  return Response.json({
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: [{ id, isResolved: true, isOutdated: false }],
            pageInfo: { hasNextPage, endCursor: cursor }
          }
        }
      }
    }
  });
}

function installThreadSource(getPage: () => Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/graphql")) return Promise.resolve(getPage());
      if (url.includes("/reviews?")) return Promise.resolve(Response.json([]));
      if (url.includes("/check-runs?")) {
        return Promise.resolve(Response.json({ check_runs: [] }));
      }
      if (url.endsWith("/pulls/1")) {
        return Promise.resolve(
          Response.json({
            number: 1,
            state: "open",
            draft: false,
            head: { sha: "head" },
            requested_reviewers: []
          })
        );
      }
      throw new Error("Unexpected test endpoint.");
    })
  );
}

function collectEvidence() {
  return buildApprovalInput("test-token", { owner: "owner", repo: "repo" }, 1, [
    { name: "delivery-controls", appSlug: "github-actions" }
  ]);
}

describe("review-thread pagination completeness", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects a repeated continuation cursor", async () => {
    let pages = 0;
    installThreadSource(() => threadPage("same-cursor", String(++pages)));
    await expect(collectEvidence()).rejects.toThrow(/repeated a thread cursor/);
    expect(pages).toBe(2);
  });

  it("rejects a duplicated thread across otherwise advancing pages", async () => {
    let pages = 0;
    installThreadSource(() => threadPage(String(++pages), "same-thread"));
    await expect(collectEvidence()).rejects.toThrow(/review-thread identity/);
  });

  it("never accepts a truncated connection at its page bound", async () => {
    let pages = 0;
    installThreadSource(() => threadPage(String(++pages), String(pages)));
    await expect(collectEvidence()).rejects.toThrow(/complete-coverage limit/);
    expect(pages).toBe(20);
  });

  it("accepts the bound only when the last page explicitly completes coverage", async () => {
    let pages = 0;
    installThreadSource(() => threadPage(String(++pages), String(pages), pages < 20));
    const evidence = await collectEvidence();
    expect(evidence.reviewThreads).toHaveLength(20);
    expect(pages).toBe(20);
  });
});
