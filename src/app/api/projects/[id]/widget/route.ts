import { NextRequest } from "next/server";
import { withAuth, json } from "@/lib/http";
import { ensureWidgetToken, rotateWidgetToken, widgetSnippet } from "@/lib/widget";

export const runtime = "nodejs";

function originOf(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "http";
  return host ? `${proto}://${host}` : req.nextUrl.origin;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const token = ensureWidgetToken(identity, Number(id));
    return json({
      token: token.token,
      snippet: widgetSnippet(originOf(req), token.token),
    });
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const token = rotateWidgetToken(identity, Number(id));
    return json({
      token: token.token,
      snippet: widgetSnippet(originOf(req), token.token),
    });
  });
}
