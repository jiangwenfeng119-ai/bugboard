import type { AnalyticsRange, AnalyticsTrend, AnalyticsTrendPoint } from "./types";
import { recentShanghaiDateKeys, shanghaiDateKey } from "./time";

const DAY_MS = 86_400_000;
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function buildAnalyticsTrend(
  range: AnalyticsRange,
  rows: { day: string; count: number }[],
  now = new Date()
): AnalyticsTrend {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!DAY_KEY.test(row.day) || row.count <= 0) continue;
    counts.set(row.day, (counts.get(row.day) || 0) + row.count);
  }

  if (range !== "all") {
    return {
      grain: "day",
      points: recentShanghaiDateKeys(range, now).map((day) =>
        dayPoint(day, counts.get(day) || 0)
      ),
    };
  }

  const today = shanghaiDateKey(now);
  const known = [...counts.keys()].sort();
  if (known.length === 0 || !today) {
    return {
      grain: "day",
      points: recentShanghaiDateKeys(14, now).map((day) => dayPoint(day, 0)),
    };
  }

  const first = known[0];
  const last = known[known.length - 1];
  const end = today > last ? today : last;
  const span = inclusiveDays(first, end);

  if (span <= 92) {
    return {
      grain: "day",
      points: eachDateKey(first, end).map((day) => dayPoint(day, counts.get(day) || 0)),
    };
  }

  if (span <= 420) {
    const weeks = new Map<string, number>();
    for (const day of eachDateKey(first, end)) {
      const week = mondayKey(day);
      weeks.set(week, (weeks.get(week) || 0) + (counts.get(day) || 0));
    }
    return {
      grain: "week",
      points: [...weeks.keys()].sort().map((week) => ({
        key: week,
        label: week.slice(5),
        hint: `${week} 当周`,
        count: weeks.get(week) || 0,
      })),
    };
  }

  const months = new Map<string, number>();
  for (const [day, count] of counts) {
    if (day < first || day > end) continue;
    const month = day.slice(0, 7);
    months.set(month, (months.get(month) || 0) + count);
  }
  const monthKeys = eachMonth(first.slice(0, 7), end.slice(0, 7));
  const multiYear = new Set(monthKeys.map((key) => key.slice(0, 4))).size > 1;
  return {
    grain: "month",
    points: monthKeys.map((month) => ({
      key: month,
      label: monthLabel(month, multiYear),
      hint: `${month.slice(0, 4)}年${Number(month.slice(5))}月`,
      count: months.get(month) || 0,
    })),
  };
}

function dayPoint(day: string, count: number): AnalyticsTrendPoint {
  return { key: day, label: day.slice(5), hint: day, count };
}

function dateKeyToUtc(key: string) {
  const match = DAY_KEY.exec(key);
  if (!match) return Number.NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function utcToDateKey(ms: number) {
  const date = new Date(ms);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

function inclusiveDays(start: string, end: string) {
  return Math.round((dateKeyToUtc(end) - dateKeyToUtc(start)) / DAY_MS) + 1;
}

function eachDateKey(start: string, end: string) {
  const keys: string[] = [];
  let cursor = dateKeyToUtc(start);
  const last = dateKeyToUtc(end);
  if (Number.isNaN(cursor) || Number.isNaN(last) || cursor > last) return keys;
  for (let i = 0; i < 500 && cursor <= last; i += 1) {
    keys.push(utcToDateKey(cursor));
    cursor += DAY_MS;
  }
  return keys;
}

function mondayKey(day: string) {
  const ms = dateKeyToUtc(day);
  const dow = new Date(ms).getUTCDay();
  const delta = dow === 0 ? 6 : dow - 1;
  return utcToDateKey(ms - delta * DAY_MS);
}

function eachMonth(start: string, end: string) {
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5));
  const endYear = Number(end.slice(0, 4));
  const endMonth = Number(end.slice(5));
  const keys: string[] = [];
  for (let i = 0; i < 240; i += 1) {
    keys.push(`${year}-${String(month).padStart(2, "0")}`);
    if (year === endYear && month === endMonth) break;
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  return keys;
}

function monthLabel(month: string, multiYear: boolean) {
  const year = month.slice(0, 4);
  const n = Number(month.slice(5));
  return multiYear ? `${year.slice(2)}/${n}` : `${n}月`;
}
