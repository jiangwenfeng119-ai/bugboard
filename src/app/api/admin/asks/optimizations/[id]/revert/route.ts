import { NextRequest } from "next/server";
import { askCallbackUrl } from "@/lib/ask-core";
import { requestOptimizeRevert } from "@/lib/ask-optimize";
import { error, json, withAuth } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const optimizationId = Number(id);
    if (!Number.isInteger(optimizationId) || optimizationId <= 0) return error("这次优化不存在", 404);
    const optimization = await requestOptimizeRevert(
      identity,
      optimizationId,
      askCallbackUrl({
        configured: process.env.BUGBOARD_CALLBACK_ORIGIN || process.env.BASE_URL,
        requestOrigin: req.nextUrl.origin,
      }).replace(/\/api\/ask\/callback$/, "/api/ask/optimizations/callback")
    );
    return json({ optimization });
  });
}
