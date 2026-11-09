import { NextRequest, NextResponse } from "next/server";
import { clientIpFromHeaders } from "@/lib/login-throttle";
import { createWidgetReport } from "@/lib/widget";

export const runtime = "nodejs";

function cors(response: NextResponse) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return response;
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await ctx.params;
    const form = await req.formData();
    const fileItem = form.get("file");
    const bug = createWidgetReport(decodeURIComponent(token), {
      ip: clientIpFromHeaders(req.headers),
      title: String(form.get("title") || ""),
      note: String(form.get("note") || ""),
      pageUrl: String(form.get("pageUrl") || ""),
      viewport: String(form.get("viewport") || ""),
      userAgent: String(form.get("userAgent") || ""),
      consoleText: String(form.get("console") || ""),
      file:
        fileItem instanceof File && fileItem.size
          ? {
              filename: fileItem.name || "圈选.png",
              mime: fileItem.type || "image/png",
              buffer: Buffer.from(await fileItem.arrayBuffer()),
            }
          : null,
    });
    return cors(NextResponse.json({ id: bug.id, publicId: bug.public_id }, { status: 201 }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "上报失败";
    const status = message.includes("频繁") ? 429 : 400;
    return cors(NextResponse.json({ error: message }, { status }));
  }
}
