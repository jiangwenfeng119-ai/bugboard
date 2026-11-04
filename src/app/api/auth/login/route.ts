import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { error, json } from "@/lib/http";
import { login } from "@/lib/services";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const user = await login(body.username || "", body.password || "");
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
    return error(e instanceof Error ? e.message : "登录失败", 401);
  }
}
