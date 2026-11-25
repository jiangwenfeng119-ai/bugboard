import { NextRequest } from "next/server";
import { acceptOptimizeCallback } from "@/lib/ask-optimize";
import { error, json, publicErrorMessage, statusForMessage } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const raw = await req.text();
  try {
    return json(acceptOptimizeCallback(raw, req.headers.get("x-bugboard-signature") || ""));
  } catch (e) {
    const message = publicErrorMessage(e instanceof Error ? e.message : "服务器错误");
    return error(message, message === "签名不对" ? 401 : statusForMessage(message));
  }
}
