import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logError, logInfo } from "./safeLog.js";

function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Duplication configuration/report must contain JSON objects.");
  }
}

function readPolicy(configFile: string): { paths: string[]; threshold: number } {
  const policy: unknown = JSON.parse(fs.readFileSync(configFile, "utf8"));
  assertRecord(policy);
  const paths = policy.path;
  if (
    !Array.isArray(paths) ||
    paths.length === 0 ||
    !paths.every((entry): entry is string => typeof entry === "string" && entry.length > 0)
  ) {
    throw new Error("Duplication policy requires nonempty source paths.");
  }
  if (
    typeof policy.threshold !== "number" ||
    !Number.isFinite(policy.threshold) ||
    policy.threshold < 0
  ) {
    throw new Error("Duplication policy requires an explicit nonnegative threshold.");
  }
  return {
    // JSCPD's globbing needs slash-separated CLI scopes on Windows.
    paths: paths.map((entry) => path.resolve(path.dirname(configFile), entry).replace(/\\/g, "/")),
    threshold: policy.threshold
  };
}

function location(value: unknown): string {
  assertRecord(value);
  if (typeof value.name !== "string" || typeof value.start !== "number") {
    throw new Error("Malformed duplication location.");
  }
  return `${value.name}:${value.start}`;
}

function readReport(file: string) {
  if (!fs.existsSync(file)) throw new Error("Duplication detector produced no coverage report.");
  const report: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  assertRecord(report);
  const statistics = report.statistics;
  assertRecord(statistics);
  const total = statistics.total;
  assertRecord(total);
  if (
    typeof total.sources !== "number" ||
    !Number.isSafeInteger(total.sources) ||
    total.sources <= 0
  )
    throw new Error("Duplication detector scanned no files.");
  if (
    typeof total.percentage !== "number" ||
    !Number.isFinite(total.percentage) ||
    !Array.isArray(report.duplicates)
  )
    throw new Error("Malformed duplication statistics.");
  const duplicates = report.duplicates.map((entry: unknown) => {
    assertRecord(entry);
    return { first: location(entry.firstFile), second: location(entry.secondFile) };
  });
  return { sources: total.sources, percentage: total.percentage, duplicates };
}

function check(configFile: string): number {
  const policy = readPolicy(configFile);
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "devhawks-duplication-"));
  try {
    const result = spawnSync(
      process.execPath,
      [
        path.resolve("node_modules", "jscpd", "bin", "jscpd"),
        "--config",
        configFile,
        "--reporters",
        "json",
        "--output",
        output,
        "--silent",
        ...policy.paths
      ],
      { encoding: "utf8", timeout: 60_000 }
    );
    if (result.error) throw result.error;
    if (result.signal || result.status === null)
      throw new Error("Duplication detector did not complete.");
    const report = readReport(path.join(output, "jscpd-report.json"));
    const exceeds =
      report.percentage > policy.threshold ||
      (policy.threshold === 0 && report.duplicates.length > 0);
    if (exceeds) {
      logError("duplication-threshold", { threshold: policy.threshold, ...report });
      return 1;
    }
    if (result.status !== 0) throw new Error("Duplication detector reported a tool failure.");
    logInfo("duplication-pass", { sources: report.sources, clones: report.duplicates.length });
    return 0;
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
}

function configArgument(args: string[]): string {
  if (args.length === 0) return path.resolve(".jscpd.json");
  if (args.length !== 2 || args[0] !== "--config" || !args[1]) {
    throw new Error("Expected only --config <path>.");
  }
  return path.resolve(args[1]);
}

try {
  process.exitCode = check(configArgument(process.argv.slice(2)));
} catch (error) {
  logError("duplication-error", {
    message: error instanceof Error ? error.message : String(error)
  });
  process.exitCode = 2;
}
