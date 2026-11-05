import { NextRequest } from "next/server";
import { withAuth, json } from "@/lib/http";
import { deleteProject, getProject, updateProject } from "@/lib/services";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const project = getProject(identity, Number(id));
    return json({ project });
  });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const body = await req.json();
    const project = updateProject(identity, Number(id), {
      name: typeof body.name === "string" ? body.name : "",
      ...(typeof body.description === "string"
        ? { description: body.description }
        : {}),
      ...(typeof body.code === "string" ? { code: body.code } : {}),
    });
    return json({ project });
  });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    deleteProject(identity, Number(id));
    return json({ ok: true });
  });
}
