import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { isSetupComplete } from "@/lib/db";
import { error, json } from "@/lib/http";
import { setupAdmin } from "@/lib/services";

export const runtime = "nodejs";

export async function GET() {
  return json({ setupRequired: !isSetupComplete() });
}

export async function POST(req: NextRequest) {
  try {
    if (isSetupComplete()) return error("系统已完成首装", 400);
    const body = await req.json();
    const user = await setupAdmin(body.username || "", body.password || "");
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
    return error(e instanceof Error ? e.message : "首装失败", 400);
  }
}
