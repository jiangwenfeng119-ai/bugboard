import { NextRequest } from "next/server";
import { withAuth, json } from "@/lib/http";
import { transitionBug } from "@/lib/services";
import type { TransitionAction } from "@/lib/state-machine";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const contentType = req.headers.get("content-type") || "";
    let action: TransitionAction;
    let note: string | undefined;
    let files: { filename: string; mime: string; buffer: Buffer }[] = [];

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      action = String(form.get("action") || "") as TransitionAction;
      note = String(form.get("note") || "") || undefined;
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
      action = body.action;
      note = body.note;
    }

    const { bug, eventId } = transitionBug(
      identity,
      Number(id),
      action,
      note,
      files.map((file) => ({ filename: file.filename, buffer: file.buffer }))
    );
    return json({ bug, eventId });
  });
}
