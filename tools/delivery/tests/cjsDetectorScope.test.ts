import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function fixtureDir(): string {
  const root = path.resolve("tools", "delivery", "fixtures", "tmp-jscpd-cjs");
  fs.mkdirSync(root, { recursive: true });
  return fs.mkdtempSync(path.join(root, "run-"));
}

describe("cjs detector scope", () => {
  it("fails on duplicated CJS code when jscpd pattern includes cjs", () => {
    const dir = fixtureDir();
    try {
      const duplicate = `
        function longSample(value, extra) {
          const normalized = String(value).trim().toLowerCase();
          const collected = [normalized, extra, normalized].join("-");
          const result = collected.split("-").filter(Boolean).map((part) => part.trim()).join("|");
          return result + "::" + normalized + "::" + extra;
        }
        module.exports = { longSample };
      `;
      fs.writeFileSync(path.join(dir, "a.cjs"), duplicate);
      fs.writeFileSync(path.join(dir, "b.cjs"), duplicate);
      const result = spawnSync(
        "node",
        [
          "node_modules/jscpd/bin/jscpd.js",
          "--silent",
          "--pattern",
          "**/*.cjs",
          "--min-tokens",
          "20",
          "--threshold",
          "0",
          dir
        ],
        { encoding: "utf-8", cwd: path.resolve(".") }
      );
      expect(result.status).not.toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
