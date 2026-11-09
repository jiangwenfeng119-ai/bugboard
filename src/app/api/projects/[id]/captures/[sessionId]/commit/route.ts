import { NextRequest } from "next/server";
import { commitCaptureSession, type DraftUpdate } from "@/lib/captures";
import { withAuth, json } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; sessionId: string }> }
) {
  return withAuth(req, async (identity) => {
    const { sessionId } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const drafts = Array.isArray(body.drafts) ? (body.drafts as DraftUpdate[]) : undefined;
    const result = await commitCaptureSession(identity, Number(sessionId), drafts);
    return json({
      session: result.session,
      bugs: result.bugs.map((bug) => ({ id: bug.id, publicId: bug.public_id, title: bug.title })),
    });
  });
}
