import { NextRequest } from "next/server";
import { readAsk } from "@/lib/ask-store";
import { json, withAuth } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; runId: string }> }) {
  return withAuth(req, async (identity) => {
    const { id, runId } = await ctx.params;
    return json({ run: readAsk(identity, Number(id), Number(runId)) });
  });
}
