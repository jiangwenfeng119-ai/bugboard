import { describe, expect, it } from "vitest";
import { buildAnalyticsTrend } from "../src/lib/analytics-trend";

const now = new Date("2026-11-06T02:00:00.000Z");

describe("analytics trend buckets", () => {
  it("fills every day of a fixed window and ignores days outside it", () => {
    const trend = buildAnalyticsTrend(
      7,
      [
        { day: "2026-11-06", count: 2 },
        { day: "2026-11-04", count: 1 },
        { day: "2026-10-01", count: 9 },
        { day: "nope", count: 4 },
      ],
      now
    );
    expect(trend.grain).toBe("day");
    expect(trend.points).toHaveLength(7);
    expect(trend.points[0]).toMatchObject({ key: "2026-10-31", count: 0, label: "10-31" });
    expect(trend.points.at(-1)).toMatchObject({ key: "2026-11-06", count: 2, hint: "2026-11-06" });
    expect(trend.points.find((point) => point.key === "2026-11-04")?.count).toBe(1);
    expect(trend.points.reduce((sum, point) => sum + point.count, 0)).toBe(3);
  });

  it("shows a short empty axis when nothing has been filed", () => {
    const trend = buildAnalyticsTrend("all", [], now);
    expect(trend.grain).toBe("day");
    expect(trend.points).toHaveLength(14);
    expect(trend.points.every((point) => point.count === 0)).toBe(true);
    expect(trend.points.at(-1)?.key).toBe("2026-11-06");
  });

  it("groups a long history into weeks without dropping counts", () => {
    const trend = buildAnalyticsTrend(
      "all",
      [
        { day: "2026-06-01", count: 3 },
        { day: "2026-06-02", count: 1 },
        { day: "2026-11-06", count: 2 },
      ],
      now
    );
    expect(trend.grain).toBe("week");
    expect(trend.points[0]).toMatchObject({ key: "2026-06-01", count: 4, label: "06-01" });
    expect(trend.points.at(-1)).toMatchObject({
      key: "2026-11-02",
      count: 2,
      hint: "2026-11-02 当周",
    });
    expect(trend.points.reduce((sum, point) => sum + point.count, 0)).toBe(6);
  });

  it("groups multi-year history into months", () => {
    const trend = buildAnalyticsTrend(
      "all",
      [
        { day: "2024-01-15", count: 2 },
        { day: "2026-11-01", count: 1 },
      ],
      now
    );
    expect(trend.grain).toBe("month");
    expect(trend.points[0]).toMatchObject({
      key: "2024-01",
      label: "24/1",
      hint: "2024年1月",
      count: 2,
    });
    expect(trend.points.at(-1)).toMatchObject({ key: "2026-11", label: "26/11", count: 1 });
    expect(trend.points.reduce((sum, point) => sum + point.count, 0)).toBe(3);
    expect(trend.points.some((point) => point.key === "2025-06" && point.count === 0)).toBe(true);
  });
});
