const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_USERNAME = 8;
const MAX_PER_IP = 40;

type Bucket = { fails: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export const LOGIN_THROTTLED = "尝试过多，请稍后再试";

function hit(key: string, now: number) {
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) return { fails: 0, resetAt: now + WINDOW_MS };
  return current;
}

function prune(now: number) {
  if (buckets.size < 2000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function assertLoginAllowed(ip: string, username: string) {
  const now = Date.now();
  prune(now);
  const user = hit(`user:${username}`, now);
  const addr = hit(`ip:${ip}`, now);
  if (user.fails >= MAX_PER_USERNAME || addr.fails >= MAX_PER_IP) {
    throw new Error(LOGIN_THROTTLED);
  }
}

export function recordLoginFailure(ip: string, username: string) {
  const now = Date.now();
  for (const key of [`user:${username}`, `ip:${ip}`]) {
    const current = hit(key, now);
    buckets.set(key, { fails: current.fails + 1, resetAt: current.resetAt });
  }
}

export function clearLoginFailures(username: string) {
  buckets.delete(`user:${username}`);
}

export function resetLoginThrottleForTests() {
  buckets.clear();
}

export function clientIpFromHeaders(headers: Headers) {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 80);
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded.slice(0, 80);
  return "unknown";
}
