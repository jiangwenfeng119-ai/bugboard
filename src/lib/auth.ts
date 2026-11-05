import { getIronSession, SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";
import { getDb, nowIso } from "./db";
import type { Identity, Role, UserRow } from "./types";

export type SessionData = {
  userId?: number;
};

export const DEV_SESSION_SECRET =
  "dev-only-session-secret-change-me-32chars!!";

/** 生产启动时调用；勿在 sessionOptions 内硬抛，以免 next build 失败 */
export function assertProductionSessionSecret() {
  if (process.env.NODE_ENV !== "production") return;
  const fromEnv = process.env.SESSION_SECRET?.trim();
  if (!fromEnv || fromEnv === DEV_SESSION_SECRET) {
    throw new Error(
      "生产环境必须设置强随机 SESSION_SECRET（勿使用开发默认值）"
    );
  }
}

export function sessionOptions(): SessionOptions {
  const password = process.env.SESSION_SECRET?.trim() || DEV_SESSION_SECRET;
  return {
    cookieName: "bugboard_session",
    password,
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    },
  };
}

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions());
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function hashApiKey(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

export function generateApiKey() {
  const raw = `bb_${randomBytes(24).toString("base64url")}`;
  return {
    raw,
    hash: hashApiKey(raw),
    prefix: raw.slice(0, 10),
  };
}

export function safeEqualHex(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function getUserById(id: number): UserRow | undefined {
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as
    | UserRow
    | undefined;
}

export async function resolveSessionIdentity(): Promise<Identity | null> {
  const session = await getSession();
  if (!session.userId) return null;
  const user = getUserById(session.userId);
  if (!user || !user.active) return null;
  return {
    kind: "user",
    userId: user.id,
    role: user.role,
    username: user.username,
  };
}

export function resolveApiKeyIdentity(bearer: string | null): Identity | null {
  if (!bearer?.startsWith("Bearer ")) return null;
  const raw = bearer.slice(7).trim();
  if (!raw) return null;
  const hash = hashApiKey(raw);
  const row = getDb()
    .prepare(
      "SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL AND disabled_at IS NULL"
    )
    .get(hash) as
    | {
        id: number;
        name: string;
        role: Role;
      }
    | undefined;
  if (!row) return null;
  getDb()
    .prepare(
      "UPDATE api_keys SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?"
    )
    .run(nowIso(), row.id);
  const projectIds = (
    getDb()
      .prepare("SELECT project_id FROM api_key_projects WHERE api_key_id = ?")
      .all(row.id) as { project_id: number }[]
  ).map((r) => r.project_id);
  return {
    kind: "api_key",
    apiKeyId: row.id,
    role: row.role,
    name: row.name,
    projectIds,
  };
}

export async function resolveRequestIdentity(
  authorization: string | null
): Promise<Identity | null> {
  const api = resolveApiKeyIdentity(authorization);
  if (api) return api;
  return resolveSessionIdentity();
}

export function actorFromIdentity(identity: Identity): {
  actorType: "user" | "api_key";
  actorId: number;
} {
  if (identity.kind === "user") {
    return { actorType: "user", actorId: identity.userId };
  }
  return { actorType: "api_key", actorId: identity.apiKeyId };
}
