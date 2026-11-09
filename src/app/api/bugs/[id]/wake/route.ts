import { NextRequest } from "next/server";
import { wakeBugNow } from "@/lib/dispatch";
import { json, withAuth } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    wakeBugNow(identity, Number(id));
    return json({ ok: true });
  });
}
