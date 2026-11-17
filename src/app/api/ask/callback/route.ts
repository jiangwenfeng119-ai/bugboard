import { NextRequest } from "next/server";
import { acceptAskCallback } from "@/lib/ask-store";
import { error, json, publicErrorMessage, statusForMessage } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const raw = await req.text();
  try {
    const result = acceptAskCallback(raw, req.headers.get("x-bugboard-signature") || "");
    return json(result);
  } catch (e) {
    const message = publicErrorMessage(e instanceof Error ? e.message : "服务器错误");
    return error(message, message === "签名不对" ? 401 : statusForMessage(message));
  }
}
