import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runGithubApprovalGate } from "../src/githubCopilotApprovalCheck.js";
import {
  type MockHandler,
  firstPageReviews,
  freshHeadHandler,
  paginatedReviewHandler,
  response
} from "./githubApprovalHttpFixtures.js";

function configureEnvironment(eventFile: string): void {
  process.env.GITHUB_TOKEN = "token";
  process.env.GITHUB_REPOSITORY = "owner/repo";
  process.env.GITHUB_EVENT_PATH = path.resolve(
    "tools",
    "delivery",
    "fixtures",
    "approval-events",
    eventFile
  );
  process.env.REQUIRED_CHECKS_JSON = '[{"name":"delivery-controls","appSlug":"github-actions"}]';
}

function installFetchMock(handler: MockHandler): void {
  const mocked = vi.fn((input: string | URL | Request) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return Promise.resolve(handler(url));
  });
  vi.stubGlobal("fetch", mocked);
}

function restoreEnvironment(): void {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_REPOSITORY;
  delete process.env.GITHUB_EVENT_PATH;
  delete process.env.REQUIRED_CHECKS_JSON;
}

describe("github copilot approval check", () => {
  afterEach(restoreEnvironment);

  it("fetches fresh PR state and evaluates checks for the current head", async () => {
    configureEnvironment("pull-request.json");
    const calls: string[] = [];
    installFetchMock(freshHeadHandler(calls));
    const exitCode = await runGithubApprovalGate();
    expect(exitCode).toBe(0);
    expect(calls.some((entry) => entry.includes("/commits/fresh-head/check-runs"))).toBe(true);
    expect(calls.filter((entry) => entry.endsWith("/pulls/17"))).toHaveLength(2);
  });
});

describe("incomplete approval evidence", () => {
  afterEach(restoreEnvironment);

  it.each([
    { route: "/reviews?", payload: null },
    { route: "/reviews?", payload: [null] },
    { route: "/check-runs?", payload: {} },
    { route: "/check-runs?", payload: { check_runs: [null] } },
    { route: "/graphql", payload: { data: null } },
    { route: "/graphql", payload: { errors: [{ message: "Unavailable" }] } }
  ])("rejects malformed $route evidence", async ({ route, payload }) => {
    configureEnvironment("pull-request.json");
    const baseline = freshHeadHandler([]);
    installFetchMock((url) => (url.includes(route) ? response(payload) : baseline(url)));
    await expect(runGithubApprovalGate()).rejects.toThrow(/GitHub/);
  });
});

describe("mutating approval state", () => {
  afterEach(restoreEnvironment);
  it("rejects a head change during collection", async () => {
    configureEnvironment("pull-request.json");
    const baseline = freshHeadHandler([]);
    let pullReads = 0;
    installFetchMock((url) => {
      if (url.endsWith("/pulls/17") && ++pullReads === 2) {
        return response({
          number: 17,
          state: "open",
          draft: false,
          head: { sha: "new-head" },
          requested_reviewers: []
        });
      }
      return baseline(url);
    });
    await expect(runGithubApprovalGate()).rejects.toThrow(/head changed/);
  });

  it("rejects a pending Copilot re-review", async () => {
    configureEnvironment("pull-request.json");
    const baseline = freshHeadHandler([]);
    installFetchMock((url) =>
      url.endsWith("/pulls/17")
        ? response({
            number: 17,
            state: "open",
            draft: false,
            head: { sha: "fresh-head" },
            requested_reviewers: [{ login: "copilot-pull-request-reviewer[bot]" }]
          })
        : baseline(url)
    );
    await expect(runGithubApprovalGate()).rejects.toThrow(/re-review is still requested/);
  });
});

describe("complete approval pagination", () => {
  afterEach(restoreEnvironment);
  it("rejects repeated REST identities instead of merging partial pages", async () => {
    configureEnvironment("pull-request.json");
    const baseline = freshHeadHandler([]);
    installFetchMock((url) =>
      url.includes("/reviews?") ? response(firstPageReviews()) : baseline(url)
    );
    await expect(runGithubApprovalGate()).rejects.toThrow(/repeated an identity/);
  });

  it("rejects exhausted review pagination", async () => {
    configureEnvironment("pull-request.json");
    const baseline = freshHeadHandler([]);
    let pages = 0;
    installFetchMock((url) => {
      if (!url.includes("/reviews?")) return baseline(url);
      const offset = pages++ * 100;
      return response(
        firstPageReviews().map((review) => ({
          ...review,
          id: Number(review.id) + offset
        }))
      );
    });
    await expect(runGithubApprovalGate()).rejects.toThrow(/complete-coverage limit/);
    expect(pages).toBe(20);
  });
  it("paginates reviews and accepts superseded requested-changes reviews", async () => {
    configureEnvironment("workflow-run.json");
    installFetchMock(paginatedReviewHandler());
    const exitCode = await runGithubApprovalGate();
    expect(exitCode).toBe(0);
  });
});
