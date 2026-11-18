import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { askImagePath, askImageTokenOk } from "@/lib/ask-images";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export async function GET(req: NextRequest, ctx: { params: Promise<{ runId: string; file: string }> }) {
  const { runId, file } = await ctx.params;
  const id = Number(runId);
  const name = path.basename(decodeURIComponent(file));
  const row =
    Number.isInteger(id) && id > 0
      ? (getDb()
          .prepare(
            `SELECT d.webhook_secret AS secret
             FROM ask_runs r
             JOIN project_dispatch d ON d.project_id = r.project_id
             WHERE r.id = ?`
          )
          .get(id) as { secret: string } | undefined)
      : undefined;
  if (!row?.secret || !askImageTokenOk(row.secret, id, name, req.nextUrl.searchParams.get("t") || "")) {
    return new NextResponse(null, { status: 404 });
  }
  const abs = askImagePath(id, name);
  if (!abs) return new NextResponse(null, { status: 404 });
  const ext = path.extname(name).toLowerCase();
  return new NextResponse(new Uint8Array(fs.readFileSync(abs)), {
    headers: {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "private, max-age=60",
    },
  });
}
