import { NextRequest } from "next/server";
import { saveCodeGraph } from "@/lib/code-graph-store";
import { error, json, withAuth } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId) || projectId <= 0) return error("项目不存在", 404);
    const body = (await req.json().catch(() => null)) as {
      sha?: string;
      report?: string;
      nodes?: number;
      edges?: number;
      html?: string;
    } | null;
    if (!body) return error("图谱报告是空的");
    const graph = saveCodeGraph(identity, projectId, body);
    return json({ graph });
  });
}
