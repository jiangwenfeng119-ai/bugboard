import { describe, expect, it } from "vitest";
import { matchesProductManager } from "../src/lib/product-manager-match";

describe("matchesProductManager", () => {
  it("matches display name with dotted username", () => {
    expect(matchesProductManager("marshal.jiang", "Marshal Jiang")).toBe(true);
    expect(matchesProductManager("Marshal Jiang", "marshal.jiang")).toBe(true);
  });

  it("matches ignoring case, spaces, dots, and underscores", () => {
    expect(matchesProductManager("david_ma", "David Ma")).toBe(true);
    expect(matchesProductManager("DAVID.MA", "david ma")).toBe(true);
  });

  it("rejects empty or unrelated labels", () => {
    expect(matchesProductManager("", "Marshal Jiang")).toBe(false);
    expect(matchesProductManager("marshal.jiang", "")).toBe(false);
    expect(matchesProductManager("bailey.yan", "Marshal Jiang")).toBe(false);
    expect(matchesProductManager("Key:fixer", "Marshal Jiang")).toBe(false);
  });
});
