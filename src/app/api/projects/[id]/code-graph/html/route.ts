import { NextRequest, NextResponse } from "next/server";
import { readCodeGraphHtml } from "@/lib/code-graph-store";
import { error, withAuth } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId) || projectId <= 0) return error("项目不存在", 404);
    const html = readCodeGraphHtml(identity, projectId);
    if (!html) return error("还没有交互图谱", 404);
    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "sandbox allow-scripts",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
        "Cache-Control": "private, no-store",
      },
    });
  });
}
