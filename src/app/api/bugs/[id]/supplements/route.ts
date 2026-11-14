import { NextRequest } from "next/server";
import { withAuth, json } from "@/lib/http";
import { addBugSupplement } from "@/lib/services";
import { assertUploadsReady, saveUploadedFile } from "@/lib/uploads";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const contentType = req.headers.get("content-type") || "";
    let note = "";
    let files: { filename: string; mime: string; buffer: Buffer }[] = [];

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      note = String(form.get("note") || "");
      const uploaded = form.getAll("files");
      for (const item of uploaded) {
        if (!(item instanceof File)) continue;
        const buffer = Buffer.from(await item.arrayBuffer());
        files.push({
          filename: item.name,
          mime: item.type,
          buffer,
        });
      }
    } else {
      const body = await req.json();
      note = String(body.note || "");
    }

    assertUploadsReady(files, 0);
    const { bug, eventId } = addBugSupplement(identity, Number(id), note);
    for (const f of files) {
      saveUploadedFile({
        ownerType: "status_event",
        ownerId: eventId,
        filename: f.filename,
        mime: f.mime,
        buffer: f.buffer,
      });
    }
    return json({ bug, eventId });
  });
}
