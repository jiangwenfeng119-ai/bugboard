import { NextRequest } from "next/server";
import { claimQueuedAsks } from "@/lib/ask-store";
import { error, json, withAuth } from "@/lib/http";
import { requireAdmin } from "@/lib/permissions";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return withAuth(req, async (identity) => {
    if (identity.kind !== "api_key" || !requireAdmin(identity)) return error("需要管理员权限", 403);
    return json({ jobs: claimQueuedAsks() });
  });
}
