/** Collapse display names and usernames for comparison (Marshal Jiang ↔ marshal.jiang). */
export function normalizePersonKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function matchesProductManager(
  reporterLabel: string,
  productManager: string
): boolean {
  const a = normalizePersonKey(reporterLabel);
  const b = normalizePersonKey(productManager);
  if (!a || !b) return false;
  return a === b;
}
