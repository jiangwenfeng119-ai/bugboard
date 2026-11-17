import { NextRequest } from "next/server";
import { startAsk } from "@/lib/ask-store";
import { error, json, withAuth } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId) || projectId <= 0) return error("项目不存在", 404);
    const body = (await req.json().catch(() => null)) as {
      question?: string;
      threadId?: string;
      force?: boolean;
    } | null;
    if (!body || typeof body.question !== "string" || typeof body.threadId !== "string") {
      return error("请先写问题");
    }
    const run = await startAsk(
      identity,
      projectId,
      { question: body.question, threadId: body.threadId, force: body.force === true },
      `${req.nextUrl.origin}/api/ask/callback`
    );
    return json({ run }, 201);
  });
}
