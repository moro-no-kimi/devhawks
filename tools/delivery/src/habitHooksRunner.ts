import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assessOutcome, enforceScope, parseRunnerArgs } from "./habitHooksRunnerCore.js";
import { pythonCommandParts } from "./pythonRuntime.js";
import { logError, logInfo } from "./safeLog.js";

function runProcess(command: string, args: string[], cwd: string) {
  return spawnSync(command, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    encoding: "utf-8"
  });
}

function runHabitHooks(cwd: string, configPath: string, hookArgs: string[]): number {
  const { command, args: interpreterArgs } = pythonCommandParts();
  const sensorsShim = "from habit_hooks import sensors; import sys; sys.exit(sensors.main())";
  const mapperShim = "from habit_hooks import mapper; import sys; sys.exit(mapper.main())";
  const sensors = runProcess(
    command,
    [...interpreterArgs, "-c", sensorsShim, "--config", configPath, ...hookArgs],
    cwd
  );
  const mapper = spawnSync(
    command,
    [...interpreterArgs, "-c", mapperShim, "--config", configPath],
    {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
      encoding: "utf-8",
      input: sensors.stdout ?? ""
    }
  );

  const code = assessOutcome(sensors, mapper);
  const report = code === 0 ? logInfo : logError;
  report("habit-hooks-result", {
    exitCode: code,
    sensorStatus: sensors.status,
    mapperStatus: mapper.status,
    sensorDiagnostic: sensors.stderr,
    mapperOutput: mapper.stdout,
    mapperDiagnostic: mapper.stderr
  });
  return code;
}

export function executeRunner(rawArgs: string[]): number {
  const options = parseRunnerArgs(rawArgs);
  if (options.requireNonEmpty) {
    enforceScope(options.scopeGlobs, path.resolve(options.cwd));
  }
  return runHabitHooks(options.cwd, options.configPath, options.hookArgs);
}

const isCliEntry =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCliEntry) {
  try {
    process.exitCode = executeRunner(process.argv.slice(2));
  } catch (error) {
    logError("habit-hooks-runner-error", {
      message: error instanceof Error ? error.message : String(error)
    });
    process.exitCode = 2;
  }
}
