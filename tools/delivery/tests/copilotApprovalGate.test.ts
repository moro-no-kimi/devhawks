import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateCopilotApproval, type ApprovalInputs } from "../src/copilotApprovalGate.js";

function loadFixture(name: string): ApprovalInputs {
  const fixturePath = path.resolve("tools", "delivery", "fixtures", "approval", `${name}.json`);
  return JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as ApprovalInputs;
}

describe("copilot approval gate", () => {
  it("passes only with current-head copilot approval and successful required checks", () => {
    expect(evaluateCopilotApproval(loadFixture("pass"))).toEqual({ ok: true, errors: [] });
  });
});

describe("current-head check and finding provenance", () => {
  it("does not let an older success hide a newer queued attempt", () => {
    const fixture = loadFixture("pass");
    const previous = fixture.checkRuns[0];
    fixture.checkRuns.push({
      ...previous,
      id: previous.id + 1,
      status: "queued",
      conclusion: null,
      startedAt: null,
      completedAt: null
    });
    expect(evaluateCopilotApproval(fixture).ok).toBe(false);
  });

  it("rejects successful checks from a different commit", () => {
    const fixture = loadFixture("pass");
    fixture.checkRuns = fixture.checkRuns.map((run) => ({ ...run, headSha: "old-head" }));
    expect(evaluateCopilotApproval(fixture).ok).toBe(false);
  });

  it("does not infer resolution from an outdated comment location", () => {
    const fixture = loadFixture("pass");
    fixture.reviewThreads.push({ id: "moved-code", isResolved: false, isOutdated: true });
    expect(evaluateCopilotApproval(fixture).errors).toContain(
      "Unresolved actionable review threads: 1"
    );
  });

  it("rejects an empty required-check inventory", () => {
    const fixture = loadFixture("pass");
    fixture.requiredChecks = [];
    expect(evaluateCopilotApproval(fixture).ok).toBe(false);
  });

  it("uses review identity to break ties between equivalent timestamp formats", () => {
    const fixture = loadFixture("pass");
    const review = fixture.reviews[0];
    review.submittedAt = "2026-09-24T20:00:00Z";
    fixture.reviews.push({
      ...review,
      id: review.id + 1,
      state: "COMMENTED",
      submittedAt: "2026-09-24T20:00:00.000Z"
    });
    expect(evaluateCopilotApproval(fixture).ok).toBe(false);
  });
});

describe("review readiness", () => {
  it.each(["copilot[bot]", "github-copilot[bot]", "copilot-swe-agent[bot]"])(
    "does not substitute another Copilot-named actor for the independent reviewer",
    (userLogin) => {
      const fixture = loadFixture("pass");
      fixture.reviews = fixture.reviews.map((review) => ({ ...review, userLogin }));
      expect(evaluateCopilotApproval(fixture).ok).toBe(false);
    }
  );

  it("fails stale approvals that target an older commit", () => {
    const result = evaluateCopilotApproval(loadFixture("stale-approval"));
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("No Copilot approval exists for the current head commit.");
  });

  it("fails comment-only review states", () => {
    const result = evaluateCopilotApproval(loadFixture("comment-only"));
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("No Copilot approval exists for the current head commit.");
  });

  it("fails when only a non-copilot user approves", () => {
    const result = evaluateCopilotApproval(loadFixture("old-human-approval"));
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("No Copilot approval exists for the current head commit.");
  });

  it("fails unresolved actionable review threads", () => {
    const result = evaluateCopilotApproval(loadFixture("protection-missing"));
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Unresolved actionable review threads: 1");
  });

  it("accepts requested-changes reviews that were superseded by a newer approval", () => {
    const result = evaluateCopilotApproval(loadFixture("superseded-requested-changes"));
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails pending required checks", () => {
    const result = evaluateCopilotApproval(loadFixture("pending-check"));
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("Required check not successful");
  });
});
