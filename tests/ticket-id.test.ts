import { describe, expect, it } from "vitest";
import {
  allocateProjectCode,
  assertUsableCode,
  nextPublicId,
} from "../src/lib/ticket-id";

describe("public bug ids", () => {
  it("builds abbreviation + Shanghai date + daily sequence", () => {
    expect(nextPublicId("SOC", "2026-11-05T16:30:00.000Z", [])).toBe("SOC261106001");
    expect(nextPublicId("SOC", "2026-11-05T15:59:00.000Z", [])).toBe("SOC261105001");
    expect(nextPublicId("SOC", "2026-11-05T16:30:00.000Z", ["SOC261106001"])).toBe(
      "SOC261106002"
    );
    expect(
      nextPublicId("SOC", "2026-11-05T16:30:00.000Z", ["SOC261106001", "SOC261106009"])
    ).toBe("SOC261106010");
  });

  it("allocates a short code and refuses prefix collisions", () => {
    expect(allocateProjectCode("SOC 平台", "soc", [])).toBe("SOC");
    expect(allocateProjectCode("门户", "门户", [])).toBe("P01");
    expect(allocateProjectCode("记账", "记账", ["P01"])).toBe("P02");
    expect(() => assertUsableCode("so", ["SOC"])).toThrow(/前缀/);
    expect(() => assertUsableCode("SOC2", ["SOC"])).toThrow(/前缀/);
    expect(assertUsableCode("zc", [])).toBe("ZC");
  });
});
