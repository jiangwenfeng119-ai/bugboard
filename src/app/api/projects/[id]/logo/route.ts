import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { error, json, withAuth } from "@/lib/http";
import { readProjectLogo, removeProjectLogo, setProjectLogo } from "@/lib/project-logo";
import { uploadResponseHeaders } from "@/lib/uploads";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const file = readProjectLogo(identity, Number(id));
    if (!fs.existsSync(file.absolutePath)) return error("文件丢失", 404);
    const buf = fs.readFileSync(file.absolutePath);
    return new NextResponse(buf, {
      headers: {
        ...uploadResponseHeaders(file.filename, buf.length),
        "Cache-Control": "private, max-age=86400",
      },
    });
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const form = await req.formData();
    const item = form.get("file");
    if (!(item instanceof File) || item.size === 0) throw new Error("请选择文件");
    const result = setProjectLogo(identity, Number(id), {
      filename: item.name,
      buffer: Buffer.from(await item.arrayBuffer()),
    });
    return json(result);
  });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    return json(removeProjectLogo(identity, Number(id)));
  });
}
