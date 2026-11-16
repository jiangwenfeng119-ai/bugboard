/** Immediate release only when there is at least one ready-to-release bug. */
export function canImmediateRelease(pendingCount: number): boolean {
  return pendingCount > 0;
}
