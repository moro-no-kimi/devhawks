import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assessOutcome, parseRunnerArgs } from "../src/habitHooksRunnerCore.js";
import { pythonCommandParts } from "../src/pythonRuntime.js";

type CliCase = {
  title: string;
  expectedCode: number;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
};

describe("Habit Hooks input contracts", () => {
  it.each([
    { args: ["--confg", "config.toml"] },
    { args: ["--config"] },
    { args: ["--scope-glob", "--require-non-empty"] }
  ])("rejects unknown and missing CLI values", ({ args }) => {
    expect(() => parseRunnerArgs(args)).toThrow(/argument/);
  });

  it.each(["[{}]", '[{"smell":""}]', '[{"smell":123}]'])(
    "rejects incomplete finding schemas",
    (stdout) => {
      const sensor = { status: 0, signal: null, stdout, stderr: "", error: undefined };
      const mapper = { ...sensor, stdout: "" };
      expect(assessOutcome(sensor, mapper)).toBe(2);
    }
  );
});

function runRunner(args: string[], cwd = path.resolve(".")): number {
  const scriptPath = path.resolve("tools", "delivery", "src", "habitHooksRunner.ts");
  const result = spawnSync("node", ["--import", "tsx", scriptPath, ...args], {
    cwd,
    stdio: "pipe",
    encoding: "utf-8"
  });
  if (typeof result.status !== "number") {
    throw result.error ?? new Error("No process status was returned.");
  }
  return result.status;
}

const cliCases: CliCase[] = [
  {
    title: "returns zero for clean TypeScript input",
    expectedCode: 0,
    timeoutMs: 30000,
    args: [
      "--config",
      "tools/delivery/fixtures/habit-hooks/clean/.habit-hooks/config.toml",
      "--cwd",
      ".",
      "--scope-glob",
      "tools/delivery/fixtures/habit-hooks/clean/simple.ts",
      "--scope-glob",
      "tools/delivery/fixtures/habit-hooks/clean/component.tsx",
      "--require-non-empty",
      "--hook-arg",
      "--file",
      "--hook-arg",
      "tools/delivery/fixtures/habit-hooks/clean/component.tsx"
    ]
  },
  {
    title: "returns one for enforced findings",
    expectedCode: 1,
    timeoutMs: 30000,
    args: [
      "--config",
      "tools/delivery/fixtures/habit-hooks/enforced/.habit-hooks/config.toml",
      "--cwd",
      ".",
      "--scope-glob",
      "tools/delivery/fixtures/habit-hooks/enforced/tooManyParams.ts",
      "--require-non-empty",
      "--hook-arg",
      "--file",
      "--hook-arg",
      "tools/delivery/fixtures/habit-hooks/enforced/tooManyParams.ts"
    ]
  },
  {
    title: "returns two when detectors are missing",
    expectedCode: 2,
    timeoutMs: 30000,
    cwd: path.resolve("tools", "delivery", "fixtures", "habit-hooks", "missing-detectors"),
    args: [
      "--config",
      ".habit-hooks/config.toml",
      "--cwd",
      ".",
      "--scope-glob",
      "src/**/*.ts",
      "--require-non-empty"
    ]
  },
  {
    title: "returns two for invalid habit-hooks configuration",
    expectedCode: 2,
    cwd: path.resolve("tools", "delivery", "fixtures", "habit-hooks", "config-failure"),
    args: [
      "--config",
      ".habit-hooks/config.toml",
      "--cwd",
      ".",
      "--scope-glob",
      "src/**/*.ts",
      "--require-non-empty"
    ]
  },
  {
    title: "fails closed when habit-hooks reports empty actual scan",
    expectedCode: 2,
    cwd: path.resolve("tools", "delivery", "fixtures", "habit-hooks", "empty-scope"),
    args: [
      "--config",
      ".habit-hooks/config.toml",
      "--cwd",
      ".",
      "--scope-glob",
      "src/stillHere.ts",
      "--require-non-empty"
    ]
  }
];

describe("habit-hooks controls", () => {
  for (const testCase of cliCases) {
    it(
      testCase.title,
      () => {
        const code = runRunner(testCase.args, testCase.cwd);
        expect(code).toBe(testCase.expectedCode);
      },
      testCase.timeoutMs
    );
  }
});

describe("habit-hooks result assessment", () => {
  it("fails closed for malformed sensors json", () => {
    const exitCode = assessOutcome(
      { status: 0, signal: null, stdout: "{broken", stderr: "", error: undefined },
      { status: 0, signal: null, stdout: "", stderr: "", error: undefined }
    );
    expect(exitCode).toBe(2);
  });

  it("fails closed for signaled or missing process statuses", () => {
    const exitCode = assessOutcome(
      { status: null, signal: "SIGTERM", stdout: "[]", stderr: "", error: undefined },
      { status: 0, signal: null, stdout: "", stderr: "", error: undefined }
    );
    expect(exitCode).toBe(2);
  });

  it("fails closed for incomplete-run findings", () => {
    const exitCode = assessOutcome(
      {
        status: 0,
        signal: null,
        stdout: '[{"smell":"incomplete-run"}]',
        stderr: "",
        error: undefined
      },
      { status: 0, signal: null, stdout: "", stderr: "", error: undefined }
    );
    expect(exitCode).toBe(2);
  });
});

describe("python runtime command selection", () => {
  it("uses py launcher with pinned minor version on Windows", () => {
    expect(pythonCommandParts("win32")).toEqual({ command: "py", args: ["-3.13"] });
  });

  it("uses python3 on Linux and other non-Windows platforms", () => {
    expect(pythonCommandParts("linux")).toEqual({ command: "python3", args: [] });
    expect(pythonCommandParts("darwin")).toEqual({ command: "python3", args: [] });
  });
});
