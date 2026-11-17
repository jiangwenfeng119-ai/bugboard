import { NextRequest } from "next/server";
import { stopAsk } from "@/lib/ask-store";
import { error, json, withAuth } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; runId: string }> }) {
  return withAuth(req, async (identity) => {
    const { id, runId } = await ctx.params;
    const projectId = Number(id);
    const askId = Number(runId);
    if (!Number.isInteger(projectId) || !Number.isInteger(askId)) return error("这次提问不存在", 404);
    return json({ run: stopAsk(identity, projectId, askId) });
  });
}
