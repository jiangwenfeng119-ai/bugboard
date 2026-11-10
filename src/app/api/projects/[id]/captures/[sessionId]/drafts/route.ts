import { NextRequest } from "next/server";
import { replaceCaptureDrafts, type ReplacementDraft } from "@/lib/captures";
import { json, withAuth } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; sessionId: string }> }
) {
  return withAuth(req, async (identity) => {
    const { sessionId } = await ctx.params;
    const body = await req.json();
    const drafts = (Array.isArray(body.drafts) ? body.drafts : []) as ReplacementDraft[];
    return json({ session: replaceCaptureDrafts(identity, Number(sessionId), drafts) });
  });
}
