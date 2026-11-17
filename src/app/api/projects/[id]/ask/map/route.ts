import { NextRequest } from "next/server";
import { askCallbackUrl } from "@/lib/ask-core";
import { startFeatureMap } from "@/lib/ask-store";
import { error, json, withAuth } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId) || projectId <= 0) return error("项目不存在", 404);
    const run = await startFeatureMap(
      identity,
      projectId,
      askCallbackUrl({
        configured: process.env.BUGBOARD_CALLBACK_ORIGIN || process.env.BASE_URL,
        requestOrigin: req.nextUrl.origin,
      })
    );
    return json({ run }, 201);
  });
}
