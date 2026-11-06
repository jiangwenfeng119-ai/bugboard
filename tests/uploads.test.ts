import { describe, expect, it } from "vitest";
import { assertAllowedUpload } from "../src/lib/uploads";

describe("allowed uploads", () => {
  it("accepts markdown requirement and design files", () => {
    expect(() => assertAllowedUpload("prd.md", 12)).not.toThrow();
    expect(() => assertAllowedUpload("设计稿.MD", 12)).not.toThrow();
  });
});
