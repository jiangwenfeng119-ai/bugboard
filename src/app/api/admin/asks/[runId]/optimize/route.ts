import { NextRequest } from "next/server";
import { askCallbackUrl } from "@/lib/ask-core";
import { submitAskOptimization } from "@/lib/ask-optimize";
import { error, json, withAuth } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ runId: string }> }) {
  return withAuth(req, async (identity) => {
    const { runId } = await ctx.params;
    const id = Number(runId);
    if (!Number.isInteger(id) || id <= 0) return error("这次提问不存在", 404);
    const optimization = await submitAskOptimization(
      identity,
      id,
      askCallbackUrl({
        configured: process.env.BUGBOARD_CALLBACK_ORIGIN || process.env.BASE_URL,
        requestOrigin: req.nextUrl.origin,
      }).replace(/\/api\/ask\/callback$/, "/api/ask/optimizations/callback")
    );
    return json({ optimization }, 201);
  });
}
