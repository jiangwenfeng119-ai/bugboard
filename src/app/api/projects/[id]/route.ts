import { NextRequest } from "next/server";
import { withAuth, json } from "@/lib/http";
import { listProjectDocuments } from "@/lib/project-documents";
import { toPublicProject } from "@/lib/project-logo";
import { profilePatchFromBody } from "@/lib/project-profile";
import { deleteProject, getProject, updateProject } from "@/lib/services";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const projectId = Number(id);
    const project = getProject(identity, projectId);
    return json({
      project: toPublicProject(project),
      documents: listProjectDocuments(identity, projectId),
    });
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
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...(typeof body.description === "string"
        ? { description: body.description }
        : {}),
      ...(typeof body.code === "string" ? { code: body.code } : {}),
      ...profilePatchFromBody(body),
    });
    return json({ project: toPublicProject(project) });
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
