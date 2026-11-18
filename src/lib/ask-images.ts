import { createHmac, timingSafeEqual } from "crypto";
import fs from "fs";
import path from "path";
import { ASK_IMAGE_MAX_BYTES, ASK_IMAGE_MAX_COUNT } from "./ask-core";
import { uploadsRoot } from "./paths";

export const ASK_IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

export function askImageToken(secret: string, runId: number, filename: string) {
  return createHmac("sha256", secret).update(`ask-image\n${runId}\n${filename}`).digest("hex");
}

export function askImageTokenOk(secret: string, runId: number, filename: string, token: string) {
  const expected = Buffer.from(askImageToken(secret, runId, filename));
  const got = Buffer.from(String(token || ""));
  if (expected.length !== got.length) return false;
  return timingSafeEqual(expected, got);
}

export function askImageNameOk(filename: string) {
  return /^[A-Za-z0-9]{8,16}\.(png|jpg|jpeg|webp|gif)$/.test(filename);
}

export function askImagePath(runId: number, filename: string) {
  if (!Number.isInteger(runId) || runId <= 0 || !askImageNameOk(filename)) return "";
  const dir = path.join(uploadsRoot(), "ask", String(runId));
  const abs = path.join(dir, filename);
  if (path.dirname(abs) !== dir) return "";
  return fs.existsSync(abs) ? abs : "";
}

export function takeAskImages(items: { filename: string; buffer: Buffer }[]) {
  const kept: { filename: string; buffer: Buffer }[] = [];
  let omitted = false;
  for (const item of items) {
    const ext = path.extname(item.filename || "").toLowerCase();
    if (!ASK_IMAGE_EXT.has(ext) || item.buffer.length === 0 || item.buffer.length > ASK_IMAGE_MAX_BYTES) {
      omitted = true;
      continue;
    }
    if (kept.length >= ASK_IMAGE_MAX_COUNT) {
      omitted = true;
      break;
    }
    kept.push(item);
  }
  return { kept, omitted };
}
