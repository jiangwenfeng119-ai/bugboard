import { NextRequest, NextResponse } from "next/server";
import { resolveRequestIdentity } from "./auth";
import type { Identity } from "./types";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function withAuth(
  req: NextRequest,
  handler: (identity: Identity, req: NextRequest) => Promise<NextResponse>
) {
  try {
    const identity = await resolveRequestIdentity(
      req.headers.get("authorization")
    );
    if (!identity) return error("未登录", 401);
    return await handler(identity, req);
  } catch (e) {
    const message = e instanceof Error ? e.message : "服务器错误";
    const status =
      message.includes("无权") || message.includes("需要管理员")
        ? 403
        : message.includes("不存在")
          ? 404
          : 400;
    return error(message, status);
  }
}
