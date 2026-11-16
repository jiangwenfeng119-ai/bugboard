import { describe, expect, it } from "vitest";
import { canImmediateRelease } from "../src/lib/release-ui";

describe("canImmediateRelease", () => {
  it("disables when there are no pending release bugs", () => {
    expect(canImmediateRelease(0)).toBe(false);
  });

  it("enables when there is at least one pending release bug", () => {
    expect(canImmediateRelease(1)).toBe(true);
    expect(canImmediateRelease(3)).toBe(true);
  });
});
