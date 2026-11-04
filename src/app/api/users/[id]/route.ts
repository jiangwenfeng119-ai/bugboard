import { NextRequest } from "next/server";
import { withAuth, json } from "@/lib/http";
import { deleteUser, setUserActive, updateUser } from "@/lib/services";
import type { Role } from "@/lib/types";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const userId = Number(id);
    const body = await req.json();

    const hasProfileEdit =
      typeof body.username === "string" ||
      typeof body.role === "string" ||
      typeof body.password === "string";

    if (hasProfileEdit) {
      const user = await updateUser(identity, userId, {
        username: typeof body.username === "string" ? body.username : undefined,
        role: typeof body.role === "string" ? (body.role as Role) : undefined,
        password:
          typeof body.password === "string" ? body.password : undefined,
      });
      return json({ user });
    }

    if (typeof body.active === "boolean") {
      setUserActive(identity, userId, body.active);
      return json({ ok: true });
    }

    return json({ error: "无有效字段" }, 400);
  });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    deleteUser(identity, Number(id));
    return json({ ok: true });
  });
}
