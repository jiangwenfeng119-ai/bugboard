import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { withAuth, error, json } from "@/lib/http";
import {
  deleteProjectDocument,
  readProjectDocument,
} from "@/lib/project-documents";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; docId: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id, docId } = await ctx.params;
    const file = readProjectDocument(identity, Number(id), Number(docId));
    if (!fs.existsSync(file.absolutePath)) return error("文件丢失", 404);
    const buf = fs.readFileSync(file.absolutePath);
    return new NextResponse(buf, {
      headers: {
        "Content-Type": file.mime || "application/octet-stream",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        "Content-Length": String(file.size),
      },
    });
  });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; docId: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id, docId } = await ctx.params;
    const documents = deleteProjectDocument(identity, Number(id), Number(docId));
    return json({ documents });
  });
}
