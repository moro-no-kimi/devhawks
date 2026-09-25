import { type SpawnSyncReturns } from "node:child_process";
import { globSync } from "node:fs";

type RunnerOptions = {
  cwd: string;
  configPath: string;
  requireNonEmpty: boolean;
  scopeGlobs: string[];
  hookArgs: string[];
};

type HabitFinding = { smell: string };
type ProcessResult = Pick<
  SpawnSyncReturns<string>,
  "status" | "signal" | "stdout" | "stderr" | "error"
>;

const EMPTY_SCOPE_MARKERS = ["nothing matched [files]", "nothing scanned"];

function isFinding(value: unknown): value is HabitFinding {
  return (
    typeof value === "object" &&
    value !== null &&
    "smell" in value &&
    typeof value.smell === "string" &&
    value.smell.trim().length > 0
  );
}

function parseFindings(stdout: string): HabitFinding[] | null {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (!Array.isArray(parsed) || !parsed.every(isFinding)) return null;
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function setOptionValue(options: RunnerOptions, flag: string, value: string): void {
  if (flag === "--cwd") {
    options.cwd = value;
    return;
  }
  if (flag === "--config") {
    options.configPath = value;
    return;
  }
  if (flag === "--scope-glob") {
    options.scopeGlobs.push(value);
    return;
  }
  if (flag === "--hook-arg") {
    options.hookArgs.push(value);
  }
}

export function parseRunnerArgs(argv: string[]): RunnerOptions {
  const options: RunnerOptions = {
    cwd: ".",
    configPath: ".habit-hooks/config.toml",
    requireNonEmpty: false,
    scopeGlobs: [],
    hookArgs: []
  };
  const valueFlags = new Set(["--cwd", "--config", "--scope-glob", "--hook-arg"]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--require-non-empty") {
      options.requireNonEmpty = true;
      continue;
    }
    if (!valueFlags.has(token)) throw new Error("Unknown Habit Hooks runner argument.");
    const value = argv[index + 1];
    if (!value?.trim() || (token !== "--hook-arg" && value.startsWith("--"))) {
      throw new Error("Missing Habit Hooks runner argument value.");
    }
    setOptionValue(options, token, value);
    index += 1;
  }
  return options;
}

export function enforceScope(globs: string[], cwd: string): void {
  if (globs.length === 0) {
    throw new Error("No scope globs provided for fail-closed enforcement.");
  }
  const matches = new Set<string>();
  for (const pattern of globs) {
    const globbed = globSync(pattern, { cwd, exclude: ["**/node_modules/**"] });
    for (const match of globbed) {
      matches.add(match);
    }
  }
  if (matches.size === 0) {
    throw new Error(`Scope check failed: no files matched required globs (${globs.join(", ")}).`);
  }
}

function hasFailureSignal(processResult: ProcessResult): boolean {
  return (
    processResult.signal !== null || processResult.status === null || Boolean(processResult.error)
  );
}

function hasNonZeroStatus(status: number | null): boolean {
  return typeof status === "number" && status !== 0;
}

function shouldFailClosed(sensors: ProcessResult, mapper: ProcessResult): boolean {
  const findings = parseFindings(sensors.stdout ?? "");
  const hasEmptyScopeNotice = EMPTY_SCOPE_MARKERS.some((marker) =>
    (sensors.stderr ?? "").toLowerCase().includes(marker)
  );
  const hasIncompleteRun = (findings ?? []).some((finding) => finding.smell === "incomplete-run");
  return (
    hasFailureSignal(sensors) ||
    hasFailureSignal(mapper) ||
    !findings ||
    hasEmptyScopeNotice ||
    hasIncompleteRun
  );
}

export function assessOutcome(sensors: ProcessResult, mapper: ProcessResult): number {
  if (shouldFailClosed(sensors, mapper)) {
    return 2;
  }
  if (hasNonZeroStatus(sensors.status)) {
    return sensors.status ?? 2;
  }
  if (typeof mapper.status !== "number") {
    return 2;
  }
  return mapper.status;
}
