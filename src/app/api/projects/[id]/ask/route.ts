import { NextRequest } from "next/server";
import { askCallbackUrl } from "@/lib/ask-core";
import { startAsk } from "@/lib/ask-store";
import { error, json, withAuth } from "@/lib/http";

export const runtime = "nodejs";

async function readAskRequest(req: NextRequest) {
  const type = req.headers.get("content-type") || "";
  if (type.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (!form) return null;
    const question = form.get("question");
    const threadId = form.get("threadId");
    if (typeof question !== "string" || typeof threadId !== "string") return null;
    const images: { filename: string; buffer: Buffer }[] = [];
    for (const item of form.getAll("image")) {
      if (!(item instanceof File)) continue;
      images.push({ filename: item.name || "image.png", buffer: Buffer.from(await item.arrayBuffer()) });
    }
    const rawIds = form.get("attachmentIds");
    const attachmentIds = typeof rawIds === "string" ? parseIds(rawIds) : [];
    return {
      question,
      threadId,
      force: form.get("force") === "1" || form.get("force") === "true",
      draft: typeof form.get("draft") === "string" ? String(form.get("draft")) : "",
      images,
      attachmentIds,
    };
  }
  const body = (await req.json().catch(() => null)) as {
    question?: string;
    threadId?: string;
    force?: boolean;
    draft?: string;
    attachmentIds?: unknown;
  } | null;
  if (!body || typeof body.question !== "string" || typeof body.threadId !== "string") return null;
  return {
    question: body.question,
    threadId: body.threadId,
    force: body.force === true,
    draft: typeof body.draft === "string" ? body.draft : "",
    images: [] as { filename: string; buffer: Buffer }[],
    attachmentIds: parseIds(body.attachmentIds),
  };
}

function parseIds(value: unknown) {
  const source = Array.isArray(value) ? value : typeof value === "string" && value.trim() ? value.split(",") : [];
  return source.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId) || projectId <= 0) return error("项目不存在", 404);
    const body = await readAskRequest(req);
    if (!body) return error("请先写问题");
    const run = await startAsk(
      identity,
      projectId,
      {
        question: body.question,
        threadId: body.threadId,
        force: body.force,
        draft: body.draft,
        images: body.images,
        attachmentIds: body.attachmentIds,
      },
      askCallbackUrl({
        configured: process.env.BUGBOARD_CALLBACK_ORIGIN || process.env.BASE_URL,
        requestOrigin: req.nextUrl.origin,
      })
    );
    return json({ run }, 201);
  });
}
