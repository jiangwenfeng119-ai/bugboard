import { NextRequest } from "next/server";
import {
  clearDispatchSettings,
  getDispatchSettings,
  saveDispatchSettings,
  sendDispatchTest,
} from "@/lib/dispatch";
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
      organizeEnabled: typeof body.organizeEnabled === "boolean" ? body.organizeEnabled : undefined,
      repairLocalEnabled: typeof body.repairLocalEnabled === "boolean" ? body.repairLocalEnabled : undefined,
      rotateSecret: Boolean(body.rotateSecret),
      localAgents: Array.isArray(body.localAgents) ? body.localAgents : undefined,
    });
    return json({ settings });
  });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    clearDispatchSettings(identity, Number(id));
    return json({ ok: true });
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
