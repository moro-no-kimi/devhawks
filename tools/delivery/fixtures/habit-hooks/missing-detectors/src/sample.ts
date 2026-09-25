export function markSeen(
  productCode: string,
  observedAtIso: string,
  sourceName: string,
  scanId: string,
  archiveState: "active" | "archived"
): string {
  return `${productCode}:${observedAtIso}:${sourceName}:${scanId}:${archiveState}`;
}
