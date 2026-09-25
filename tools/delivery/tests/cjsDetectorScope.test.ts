import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";

function fixtureDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "devhawks-jscpd-cjs-"));
}

const sample = `
        function longSample(value, extra) {
          const normalized = String(value).trim().toLowerCase();
          const collected = [normalized, extra, normalized].join("-");
          const result = collected.split("-").filter(Boolean).map((part) => part.trim()).join("|");
          return result + "::" + normalized + "::" + extra;
        }
        module.exports = { longSample };
      `;

function runDetector(dir: string) {
  const policy: unknown = JSON.parse(fs.readFileSync(".jscpd.json", "utf8"));
  if (typeof policy !== "object" || policy === null || Array.isArray(policy)) {
    throw new Error("Invalid root duplication policy.");
  }
  expect("threshold" in policy ? policy.threshold : undefined).toBe(0);
  const config = path.join(dir, "jscpd.json");
  fs.writeFileSync(config, JSON.stringify({ ...policy, path: [dir] }));
  return spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      path.resolve("tools", "delivery", "src", "duplicationCheck.ts"),
      "--config",
      config
    ],
    { encoding: "utf8", cwd: path.resolve(".") }
  );
}

describe("cjs detector scope", () => {
  it("enforces the real root policy on duplicated CJS code", () => {
    const dir = fixtureDir();
    try {
      fs.writeFileSync(path.join(dir, "a.cjs"), sample);
      fs.writeFileSync(path.join(dir, "b.cjs"), sample);
      const result = runDetector(dir);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).toMatch(/duplication-threshold/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not mistake a zero-file detector run for a clean scan", () => {
    const dir = fixtureDir();
    try {
      const result = runDetector(dir);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("no coverage report");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports actual CJS coverage for a clean scan", () => {
    const dir = fixtureDir();
    try {
      fs.writeFileSync(path.join(dir, "a.cjs"), sample);
      const result = runDetector(dir);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('"sources":1');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
