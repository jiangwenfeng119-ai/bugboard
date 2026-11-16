import { getDb } from "./db";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_USERNAME = 8;
const MAX_PER_IP = 40;
const MAX_GLOBAL = 200;

export const LOGIN_THROTTLED = "尝试过多，请稍后再试";

function prune(now: number) {
  getDb()
    .prepare("DELETE FROM rate_events WHERE at <= ?")
    .run(now - WINDOW_MS);
}

function countSince(bucket: string, now: number) {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS c FROM rate_events WHERE bucket = ? AND at > ?")
    .get(bucket, now - WINDOW_MS) as { c: number };
  return row.c;
}

function addHit(bucket: string, now: number) {
  getDb().prepare("INSERT INTO rate_events (bucket, at) VALUES (?, ?)").run(bucket, now);
}

export function assertLoginAllowed(ip: string, username: string) {
  const now = Date.now();
  prune(now);
  const userFails = countSince(`login:user:${username}`, now);
  const globalFails = countSince("login:global", now);
  const ipFails = ip === "direct" ? 0 : countSince(`login:ip:${ip}`, now);
  if (userFails >= MAX_PER_USERNAME || ipFails >= MAX_PER_IP || globalFails >= MAX_GLOBAL) {
    throw new Error(LOGIN_THROTTLED);
  }
}

export function recordLoginFailure(ip: string, username: string) {
  const now = Date.now();
  const tx = getDb().transaction(() => {
    addHit(`login:user:${username}`, now);
    addHit("login:global", now);
    if (ip !== "direct") addHit(`login:ip:${ip}`, now);
  });
  tx();
}

export function clearLoginFailures(username: string) {
  getDb().prepare("DELETE FROM rate_events WHERE bucket = ?").run(`login:user:${username}`);
}

export function resetLoginThrottleForTests() {
  try {
    getDb().prepare("DELETE FROM rate_events WHERE bucket LIKE 'login:%' OR bucket LIKE 'widget:%'").run();
  } catch {
    // 测试库还没打开时忽略
  }
}

/**
 * 默认不采用客户端能自己写的转发头。只有 BUGBOARD_TRUST_PROXY=1 时，
 * 才使用代理覆盖后的 X-Real-IP，或 X-Forwarded-For 最靠近代理的一段。
 * 拿不到可信地址时返回 direct，登录不再按 IP 分桶，避免换头绕过。
 */
export function clientIpFromHeaders(headers: Headers) {
  if (process.env.BUGBOARD_TRUST_PROXY !== "1") return "direct";
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 80);
  const parts = (headers.get("x-forwarded-for") || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const nearest = parts[parts.length - 1];
  if (nearest) return nearest.slice(0, 80);
  return "direct";
}
