import { NextRequest } from "next/server";
import { withAuth, json } from "@/lib/http";
import { deleteApiKey, updateApiKey } from "@/lib/services";
import type { Role } from "@/lib/types";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const body = await req.json();
    const result = updateApiKey(identity, Number(id), {
      name: typeof body.name === "string" ? body.name : undefined,
      role:
        body.role === "user" || body.role === "admin"
          ? (body.role as Role)
          : undefined,
      projectIds: Array.isArray(body.projectIds)
        ? body.projectIds.map(Number)
        : undefined,
      disabled: typeof body.disabled === "boolean" ? body.disabled : undefined,
      regenerate: body.regenerate === true,
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
    deleteApiKey(identity, Number(id));
    return json({ ok: true });
  });
}
