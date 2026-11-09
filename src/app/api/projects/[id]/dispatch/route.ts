import { NextRequest } from "next/server";
import { getDispatchSettings, saveDispatchSettings, sendDispatchTest } from "@/lib/dispatch";
import { json, withAuth } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    return json({ settings: getDispatchSettings(identity, Number(id)) });
  });
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const body = await req.json();
    const settings = saveDispatchSettings(identity, Number(id), {
      webhookUrl: typeof body.webhookUrl === "string" ? body.webhookUrl : "",
      cursorEnabled: Boolean(body.cursorEnabled),
      rotateSecret: Boolean(body.rotateSecret),
    });
    return json({ settings });
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    sendDispatchTest(identity, Number(id));
    return json({ ok: true });
  });
}
