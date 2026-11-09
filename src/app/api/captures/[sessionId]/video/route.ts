import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { captureMediaPath } from "@/lib/captures";
import { withAuth } from "@/lib/http";
import { absoluteAttachmentPath, uploadResponseHeaders } from "@/lib/uploads";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ sessionId: string }> }
) {
  return withAuth(req, async (identity) => {
    const { sessionId } = await ctx.params;
    const media = captureMediaPath(identity, Number(sessionId), "video");
    const abs = absoluteAttachmentPath(media.path);
    const buf = fs.readFileSync(abs);
    return new NextResponse(buf, { headers: uploadResponseHeaders(media.filename, buf.length) });
  });
}
