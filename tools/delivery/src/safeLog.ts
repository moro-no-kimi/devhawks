type LogLevel = "info" | "error";

function write(level: LogLevel, event: string, data?: Record<string, unknown>): void {
  const payload: Record<string, unknown> = {
    level,
    event
  };
  if (data) {
    payload.data = data;
  }
  const line = JSON.stringify(payload);
  const output = `${line}\n`;
  if (level === "error") {
    process.stderr.write(output);
    return;
  }
  process.stdout.write(output);
}

export function logInfo(event: string, data?: Record<string, unknown>): void {
  write("info", event, data);
}

export function logError(event: string, data?: Record<string, unknown>): void {
  write("error", event, data);
}
