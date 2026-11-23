import { describe, expect, it } from "vitest";
import {
  BACK_TO_TOP_THRESHOLD_PX,
  shouldShowBackToTop,
} from "../src/lib/back-to-top";

describe("shouldShowBackToTop", () => {
  it("hides at the top of the page", () => {
    expect(shouldShowBackToTop(0)).toBe(false);
  });

  it("hides until the page has scrolled past the threshold", () => {
    expect(shouldShowBackToTop(BACK_TO_TOP_THRESHOLD_PX)).toBe(false);
    expect(shouldShowBackToTop(BACK_TO_TOP_THRESHOLD_PX + 1)).toBe(true);
  });

  it("treats negative scroll as hidden", () => {
    expect(shouldShowBackToTop(-20)).toBe(false);
  });
});
