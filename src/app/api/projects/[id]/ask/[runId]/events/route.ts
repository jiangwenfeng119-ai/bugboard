import { NextRequest } from "next/server";
import { resolveRequestIdentity } from "@/lib/auth";
import { readAsk } from "@/lib/ask-store";
import { error, publicErrorMessage, statusForMessage } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; runId: string }> }) {
  const identity = await resolveRequestIdentity(req.headers.get("authorization"));
  if (!identity) return error("未登录", 401);
  const { id, runId } = await ctx.params;
  const projectId = Number(id);
  const askId = Number(runId);
  if (!Number.isInteger(projectId) || !Number.isInteger(askId)) return error("这次提问不存在", 404);
  try {
    readAsk(identity, projectId, askId);
  } catch (e) {
    const message = publicErrorMessage(e instanceof Error ? e.message : "这次提问不存在");
    return error(message, statusForMessage(message));
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      try {
        for (;;) {
          if (req.signal.aborted) break;
          const run = readAsk(identity, projectId, askId);
          send({ run });
          if (run.status !== "streaming") break;
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      } catch (e) {
        send({ error: e instanceof Error ? e.message : "这次提问不存在" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
