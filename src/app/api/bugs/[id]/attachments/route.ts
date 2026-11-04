import { NextRequest } from "next/server";
import { withAuth, json, error } from "@/lib/http";
import { getBug, getAttachments } from "@/lib/services";
import { assertUploadsReady, saveUploadedFile } from "@/lib/uploads";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    getBug(identity, Number(id));
    return json({ attachments: getAttachments("bug", Number(id)) });
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const bugId = Number(id);
    getBug(identity, bugId);
    const form = await req.formData();
    const prepared: { filename: string; mime: string; buffer: Buffer }[] = [];
    for (const item of form.getAll("files")) {
      if (!(item instanceof File)) continue;
      prepared.push({
        filename: item.name,
        mime: item.type,
        buffer: Buffer.from(await item.arrayBuffer()),
      });
    }
    if (prepared.length === 0) return error("未选择文件");
    const existing = getAttachments("bug", bugId).length;
    assertUploadsReady(prepared, existing);
    const saved = prepared.map((f) =>
      saveUploadedFile({
        ownerType: "bug",
        ownerId: bugId,
        filename: f.filename,
        mime: f.mime,
        buffer: f.buffer,
      })
    );
    return json({ attachments: saved }, 201);
  });
}
