import { NextRequest } from "next/server";
import { withAuth, json } from "@/lib/http";
import { changeOwnPassword } from "@/lib/services";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return withAuth(req, async (identity) => {
    const body = await req.json();
    await changeOwnPassword(identity, {
      currentPassword:
        typeof body.currentPassword === "string" ? body.currentPassword : "",
      newPassword: typeof body.newPassword === "string" ? body.newPassword : "",
    });
    return json({ ok: true });
  });
}
