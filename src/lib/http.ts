import { NextRequest, NextResponse } from "next/server";
import { resolveRequestIdentity } from "./auth";
import type { Identity } from "./types";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

const FORBIDDEN = new Set([
  "需要管理员权限",
  "无权访问该项目",
  "无权删除项目",
  "无权删除报障",
  "无权修改密码",
  "无权修改超级管理员",
  "无权任命超级管理员",
  "无权使用该附件",
  "只有超级管理员可以创建管理员级 Key",
  "只有超级管理员可以管理管理员级 Key",
]);

export function statusForMessage(message: string) {
  if (FORBIDDEN.has(message)) return 403;
  if (message === "文件丢失" || message.endsWith("不存在")) return 404;
  return 400;
}

export function publicErrorMessage(message: string) {
  if (/UNIQUE constraint|SQLITE_/i.test(message)) return "请求冲突，请重试";
  return message;
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
    const raw = e instanceof Error ? e.message : "服务器错误";
    const message = publicErrorMessage(raw);
    const status = message === raw ? statusForMessage(message) : 409;
    return error(message, status);
  }
}
