import { NextRequest } from "next/server";
import { withAuth, json } from "@/lib/http";
import { getProject } from "@/lib/services";
import { stageUpload } from "@/lib/staged";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const projectId = Number(id);
    getProject(identity, projectId);
    const form = await req.formData();
    const item = form.get("file");
    if (!(item instanceof File)) throw new Error("缺少文件");
    const staged = stageUpload(identity, projectId, {
      filename: item.name,
      buffer: Buffer.from(await item.arrayBuffer()),
    });
    return json({
      upload: { id: staged.id, filename: staged.filename, size: staged.size },
    }, 201);
  });
}
