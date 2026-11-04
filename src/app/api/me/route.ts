import { NextRequest } from "next/server";
import { withAuth, json } from "@/lib/http";
import { isSetupComplete } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return withAuth(req, async (identity) =>
    json({
      setupRequired: !isSetupComplete(),
      identity:
        identity.kind === "user"
          ? {
              kind: "user",
              userId: identity.userId,
              username: identity.username,
              role: identity.role,
            }
          : {
              kind: "api_key",
              apiKeyId: identity.apiKeyId,
              name: identity.name,
              role: identity.role,
              projectIds: identity.projectIds,
            },
    })
  );
}
