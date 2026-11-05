/** Shanghai has no daylight saving time; UTC+8 is the civil offset. */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function asDate(value: string | Date) {
  return value instanceof Date ? value : new Date(value);
}

function shanghaiClock(value: string | Date) {
  const date = asDate(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + SHANGHAI_OFFSET_MS);
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function shanghaiDateKey(value: string | Date) {
  const clock = shanghaiClock(value);
  if (!clock) return "";
  return `${clock.getUTCFullYear()}-${pad(clock.getUTCMonth() + 1)}-${pad(clock.getUTCDate())}`;
}

/** YYMMDD in Asia/Shanghai, the date segment of a public bug id. */
export function shanghaiYymmdd(value: string | Date) {
  const key = shanghaiDateKey(value);
  return key ? key.slice(2).replace(/-/g, "") : "";
}

export function formatDateTime(value: string | Date) {
  const clock = shanghaiClock(value);
  if (!clock) return "";
  return `${shanghaiDateKey(value)} ${pad(clock.getUTCHours())}:${pad(clock.getUTCMinutes())}:${pad(clock.getUTCSeconds())}`;
}

export function formatDateTimeShort(value: string | Date) {
  const clock = shanghaiClock(value);
  if (!clock) return "";
  return `${pad(clock.getUTCMonth() + 1)}-${pad(clock.getUTCDate())} ${pad(clock.getUTCHours())}:${pad(clock.getUTCMinutes())}`;
}

export function shanghaiDayStartIso(dateKey: string) {
  return new Date(`${dateKey}T00:00:00+08:00`).toISOString();
}

export function recentShanghaiDateKeys(count: number, now = new Date()) {
  const [year, month, day] = shanghaiDateKey(now).split("-").map(Number);
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    keys.push(new Date(Date.UTC(year, month - 1, day - i)).toISOString().slice(0, 10));
  }
  return keys;
}

/** Calendar day of a stored UTC timestamp, for SQLite. Column must be a fixed identifier. */
export function shanghaiDaySql(column: string) {
  return `strftime('%Y-%m-%d', replace(${column}, 'Z', ''), '+8 hours')`;
}
