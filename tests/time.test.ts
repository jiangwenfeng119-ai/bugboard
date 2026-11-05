import { describe, expect, it } from "vitest";
import {
  formatDateTime,
  formatDateTimeShort,
  shanghaiDateKey,
  shanghaiYymmdd,
} from "../src/lib/time";

describe("Asia/Shanghai time", () => {
  const justAfterMidnight = "2026-11-05T16:30:00.000Z";

  it("formats an instant as Shanghai wall time", () => {
    expect(formatDateTime(justAfterMidnight)).toBe("2026-11-06 00:30:00");
    expect(formatDateTimeShort(justAfterMidnight)).toBe("11-06 00:30");
    expect(shanghaiDateKey(justAfterMidnight)).toBe("2026-11-06");
    expect(shanghaiYymmdd(justAfterMidnight)).toBe("261106");
  });

  it("keeps the previous Shanghai date before midnight", () => {
    expect(shanghaiDateKey("2026-11-05T15:59:00.000Z")).toBe("2026-11-05");
    expect(formatDateTime("2026-11-05T15:59:00.000Z")).toBe("2026-11-05 23:59:00");
  });
});
