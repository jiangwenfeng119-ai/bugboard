import { NextRequest } from "next/server";
import { withAuth, json } from "@/lib/http";
import { createApiKey, listApiKeys } from "@/lib/services";
import type { Role } from "@/lib/types";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return withAuth(req, async (identity) => {
    const keys = listApiKeys(identity).map((k) => {
      const projectIds = (
        getDb()
          .prepare(
            "SELECT project_id FROM api_key_projects WHERE api_key_id = ?"
          )
          .all(k.id) as { project_id: number }[]
      ).map((r) => r.project_id);
      return { ...k, projectIds };
    });
    return json({ keys });
  });
}

export async function POST(req: NextRequest) {
  return withAuth(req, async (identity) => {
    const body = await req.json();
    const created = createApiKey(identity, {
      name: body.name,
      role: body.role as Role,
      projectIds: body.projectIds,
    });
    return json(created, 201);
  });
}
