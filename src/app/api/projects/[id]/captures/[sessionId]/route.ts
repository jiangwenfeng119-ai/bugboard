import { NextRequest } from "next/server";
import { getCaptureSession, saveCaptureReview, type DraftUpdate } from "@/lib/captures";
import { withAuth, json } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; sessionId: string }> }
) {
  return withAuth(req, async (identity) => {
    const { sessionId } = await ctx.params;
    return json({ session: getCaptureSession(identity, Number(sessionId)) });
  });
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; sessionId: string }> }
) {
  return withAuth(req, async (identity) => {
    const { sessionId } = await ctx.params;
    const body = await req.json();
    const drafts = (body.drafts || []) as DraftUpdate[];
    return json({ session: saveCaptureReview(identity, Number(sessionId), drafts) });
  });
}
