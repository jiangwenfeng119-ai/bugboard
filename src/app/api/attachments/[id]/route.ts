import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { withAuth, error } from "@/lib/http";
import { getDb } from "@/lib/db";
import { getBug } from "@/lib/services";
import { absoluteAttachmentPath } from "@/lib/uploads";
import type { AttachmentRow, StatusEventRow } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const att = getDb()
      .prepare("SELECT * FROM attachments WHERE id = ?")
      .get(Number(id)) as AttachmentRow | undefined;
    if (!att) return error("附件不存在", 404);

    let bugId: number;
    if (att.owner_type === "bug") {
      bugId = att.owner_id;
    } else {
      const ev = getDb()
        .prepare("SELECT * FROM bug_status_events WHERE id = ?")
        .get(att.owner_id) as StatusEventRow | undefined;
      if (!ev) return error("附件不存在", 404);
      bugId = ev.bug_id;
    }
    getBug(identity, bugId);

    const abs = absoluteAttachmentPath(att.storage_path);
    if (!fs.existsSync(abs)) return error("文件丢失", 404);
    const buf = fs.readFileSync(abs);
    return new NextResponse(buf, {
      headers: {
        "Content-Type": att.mime || "application/octet-stream",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
        "Content-Length": String(att.size),
      },
    });
  });
}
