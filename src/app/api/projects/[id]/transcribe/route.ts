import { NextRequest } from "next/server";
import { glossaryPrompt } from "@/lib/glossary";
import { withAuth, json } from "@/lib/http";
import { getProject } from "@/lib/services";
import { transcribeSpeech } from "@/lib/transcribe";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const project = getProject(identity, Number(id));
    const form = await req.formData();
    const item = form.get("file");
    if (!(item instanceof File)) throw new Error("缺少录音");
    if (item.size > 50 * 1024 * 1024) throw new Error("单文件不能超过 50MB");
    try {
      const result = await transcribeSpeech(
        {
          filename: item.name || "录音.webm",
          mime: item.type || "audio/webm",
          buffer: Buffer.from(await item.arrayBuffer()),
        },
        glossaryPrompt(project)
      );
      return json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "转写失败";
      return json({ available: false, error: message });
    }
  });
}
