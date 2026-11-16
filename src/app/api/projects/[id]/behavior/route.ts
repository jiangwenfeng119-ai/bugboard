import { NextRequest } from "next/server";
import { getBehaviorSettings, saveBehaviorSettings } from "@/lib/behavior";
import { json, withAuth } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    return json({ settings: getBehaviorSettings(identity, Number(id)) });
  });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const body = await req.json();
    return json({ settings: saveBehaviorSettings(identity, Number(id), body) });
  });
}
