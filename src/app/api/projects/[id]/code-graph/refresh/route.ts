import { NextRequest } from "next/server";
import { requestCodeGraph } from "@/lib/code-graph-store";
import { error, json, withAuth } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId) || projectId <= 0) return error("项目不存在", 404);
    const result = await requestCodeGraph(identity, projectId);
    return json(result, 202);
  });
}
