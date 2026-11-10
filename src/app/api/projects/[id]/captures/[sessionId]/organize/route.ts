import { NextRequest } from "next/server";
import { skipCaptureOrganize } from "@/lib/captures";
import { json, withAuth } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; sessionId: string }> }
) {
  return withAuth(req, async (identity) => {
    const { sessionId } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    if (body.action !== "skip") throw new Error("不认识的操作");
    return json({ session: skipCaptureOrganize(identity, Number(sessionId)) });
  });
}
