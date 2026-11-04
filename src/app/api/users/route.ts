import { NextRequest } from "next/server";
import { withAuth, json } from "@/lib/http";
import { createUser, listUsers } from "@/lib/services";
import type { Role } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return withAuth(req, async (identity) => json({ users: listUsers(identity) }));
}

export async function POST(req: NextRequest) {
  return withAuth(req, async (identity) => {
    const body = await req.json();
    const user = await createUser(identity, {
      username: body.username,
      password: body.password,
      role: (body.role || "user") as Role,
    });
    return json({ user }, 201);
  });
}
