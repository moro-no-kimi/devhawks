import { spawnSync } from "node:child_process";

type PythonCommandParts = { command: string; args: string[] };

export function pythonCommandParts(platform = process.platform): PythonCommandParts {
  return platform === "win32"
    ? { command: "py", args: ["-3.13"] }
    : { command: "python3", args: [] };
}

export function readPythonVersion(parts: PythonCommandParts): string {
  const result = spawnSync(
    parts.command,
    [...parts.args, "-c", "import sys; print('.'.join(map(str, sys.version_info[:3])))"],
    { encoding: "utf-8", env: process.env }
  );
  const failed =
    result.signal !== null ||
    result.status === null ||
    Boolean(result.error) ||
    result.status !== 0;
  if (failed) {
    throw new Error(buildPythonFailureMessage(result.stderr, result.error?.message));
  }
  return result.stdout.trim();
}

function buildPythonFailureMessage(
  stderr: string | null,
  errorMessage: string | undefined
): string {
  const trimmed = stderr?.trim();
  if (trimmed) {
    return trimmed;
  }
  if (errorMessage) {
    return errorMessage;
  }
  return "python command failed";
}
