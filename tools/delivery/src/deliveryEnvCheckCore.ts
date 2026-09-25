export function npmVersionFromUserAgent(userAgent: string): string | null {
  const match = /(?:^|\s)npm\/([^\s]+)/.exec(userAgent);
  return match ? match[1] : null;
}

export function assertExactVersion(label: string, actual: string | null, expected: string): void {
  if (actual !== expected) {
    throw new Error(`${label} mismatch ${actual ?? "<missing>"}`);
  }
}
