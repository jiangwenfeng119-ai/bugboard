import { NextRequest } from "next/server";
import { withAuth, json } from "@/lib/http";
import { addMember, listMembers, removeMember, updateMemberRole } from "@/lib/services";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    return json({ members: listMembers(identity, Number(id)) });
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const body = await req.json();
    const userIds = Array.isArray(body.userIds)
      ? body.userIds.map(Number)
      : body.userId != null
        ? [Number(body.userId)]
        : [];
    if (userIds.length === 0) {
      return json({ error: "请选择用户" }, 400);
    }
    const role = body.role === undefined ? "user" : String(body.role);
    for (const userId of userIds) {
      addMember(identity, Number(id), userId, role);
    }
    return json({ members: listMembers(identity, Number(id)) });
  });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const body = await req.json();
    const userId = Number(body.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return json({ error: "请指定用户" }, 400);
    }
    updateMemberRole(identity, Number(id), userId, String(body.role ?? ""));
    return json({ members: listMembers(identity, Number(id)) });
  });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const raw = req.nextUrl.searchParams.get("userId");
    const userId = Number(raw);
    if (!raw || !Number.isInteger(userId) || userId <= 0) {
      return json({ error: "请指定要移除的用户" }, 400);
    }
    removeMember(identity, Number(id), userId);
    return json({ ok: true });
  });
}
