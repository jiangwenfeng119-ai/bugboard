import { NextRequest } from "next/server";
import { withAuth, json } from "@/lib/http";
import { addProjectDocuments } from "@/lib/project-documents";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const form = await req.formData();
    const kind = String(form.get("kind") || "");
    const files: { filename: string; mime: string; buffer: Buffer }[] = [];
    for (const item of form.getAll("files")) {
      if (!(item instanceof File)) continue;
      files.push({
        filename: item.name,
        mime: item.type,
        buffer: Buffer.from(await item.arrayBuffer()),
      });
    }
    const documents = addProjectDocuments(identity, Number(id), kind, files);
    return json({ documents }, 201);
  });
}
