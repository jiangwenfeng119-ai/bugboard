import { NextRequest } from "next/server";
import { withAuth, json } from "@/lib/http";
import { clearSeeAlso, listSeeAlso, setSeeAlso } from "@/lib/services";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    return json({ items: listSeeAlso(identity, Number(id)) });
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const publicId = String((body as { publicId?: string }).publicId || "");
    if (!publicId.trim()) throw new Error("请填写报障编号");
    setSeeAlso(identity, Number(id), publicId);
    return json({ items: listSeeAlso(identity, Number(id)) });
  });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const otherId = Number(req.nextUrl.searchParams.get("otherId"));
    if (!Number.isInteger(otherId) || otherId <= 0) throw new Error("没有要取消的报障");
    clearSeeAlso(identity, Number(id), otherId);
    return json({ items: listSeeAlso(identity, Number(id)) });
  });
}
