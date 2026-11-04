import { NextRequest } from "next/server";
import { withAuth, json, error } from "@/lib/http";
import { projectStats } from "@/lib/services";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const daysParam = Number(req.nextUrl.searchParams.get("days") || "30");
    const days = ([7, 30, 90].includes(daysParam) ? daysParam : 30) as
      | 7
      | 30
      | 90;
    const stats = projectStats(identity, Number(id), days);
    return json({ stats });
  });
}
