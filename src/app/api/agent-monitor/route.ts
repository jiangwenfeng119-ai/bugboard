import { NextRequest } from "next/server";
import { getAgentMonitor } from "@/lib/dispatch";
import { error, json, withAuth } from "@/lib/http";
import { requireAdmin } from "@/lib/permissions";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return withAuth(req, async (identity) => {
    if (!requireAdmin(identity)) return error("需要管理员权限", 403);
    const monitor = await getAgentMonitor(identity);
    return json({ monitor });
  });
}
