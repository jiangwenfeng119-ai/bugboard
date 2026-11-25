import { NextRequest } from "next/server";
import { askCallbackUrl } from "@/lib/ask-core";
import { submitOpenAskOptimizations } from "@/lib/ask-optimize";
import { json, withAuth } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return withAuth(req, async (identity) => {
    const optimization = await submitOpenAskOptimizations(
      identity,
      askCallbackUrl({
        configured: process.env.BUGBOARD_CALLBACK_ORIGIN || process.env.BASE_URL,
        requestOrigin: req.nextUrl.origin,
      }).replace(/\/api\/ask\/callback$/, "/api/ask/optimizations/callback")
    );
    return json({ optimization }, 201);
  });
}
