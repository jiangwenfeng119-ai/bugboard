import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { error, json } from "@/lib/http";
import {
  LOGIN_THROTTLED,
  assertLoginAllowed,
  clearLoginFailures,
  clientIpFromHeaders,
  recordLoginFailure,
} from "@/lib/login-throttle";
import { login } from "@/lib/services";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let username = "";
  let ip = "unknown";
  try {
    const body = await req.json();
    username = String(body.username || "").trim().toLowerCase();
    ip = clientIpFromHeaders(req.headers);
    assertLoginAllowed(ip, username);
    const user = await login(body.username || "", body.password || "");
    clearLoginFailures(username);
    const session = await getSession();
    session.userId = user.id;
    await session.save();
    return json({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "登录失败";
    if (message !== LOGIN_THROTTLED) recordLoginFailure(ip, username);
    return error(message, message === LOGIN_THROTTLED ? 429 : 401);
  }
}
