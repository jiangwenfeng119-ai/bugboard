import { NextRequest } from "next/server";
import { createCaptureSession, getCaptureSession, listCaptureSessions } from "@/lib/captures";
import { scheduleCaptureOrganize } from "@/lib/dispatch";
import { getDb } from "@/lib/db";
import { glossaryPrompt } from "@/lib/glossary";
import { withAuth, json } from "@/lib/http";
import type { Stroke } from "@/lib/strokes";
import { parseStrokes } from "@/lib/strokes";
import { transcribeSpeech } from "@/lib/transcribe";
import type { Segment } from "@/lib/transcript";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    return json({ sessions: listCaptureSessions(identity, Number(id)) });
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const form = await req.formData();
    const transcript = JSON.parse(String(form.get("transcript") || "[]")) as Segment[];
    if (!Array.isArray(transcript)) throw new Error("转写无效");
    const duration = form.get("durationSec");
    const videoItem = form.get("video");
    const meta = JSON.parse(String(form.get("frames") || "[]")) as {
      t?: number;
      note?: string;
      strokes?: unknown;
    }[];
    if (!Array.isArray(meta)) throw new Error("截图无效");
    const frames = [];
    for (let index = 0; index < meta.length; index += 1) {
      const item = form.get(`frame-${index}`);
      if (!(item instanceof File)) throw new Error("缺少截图");
      let strokes: Stroke[] = [];
      try {
        strokes = parseStrokes(meta[index]?.strokes ?? []);
      } catch (error) {
        if (error instanceof SyntaxError) throw new Error("圈选数据无效");
        throw error;
      }
      frames.push({
        t: Number(meta[index]?.t) || 0,
        note: meta[index]?.note || "",
        filename: item.name || `截图-${index + 1}.png`,
        mime: item.type || "image/png",
        buffer: Buffer.from(await item.arrayBuffer()),
        strokes,
      });
    }
    const video =
      videoItem instanceof File && videoItem.size
        ? {
            filename: videoItem.name || "走查.webm",
            mime: videoItem.type || "video/webm",
            buffer: Buffer.from(await videoItem.arrayBuffer()),
          }
        : null;
    let segments = transcript.map((segment) => ({
      start: Number(segment.start) || 0,
      end: Number(segment.end) || 0,
      text: String(segment.text || ""),
    }));
    if (video && !segments.some((segment) => segment.text.trim())) {
      segments = await serverTranscript(Number(id), video, segments);
    }
    const session = createCaptureSession(identity, Number(id), {
      transcript: segments,
      durationSec: duration == null || duration === "" ? null : Number(duration),
      truncated: String(form.get("truncated") || "") === "1",
      video,
      frames,
    });
    scheduleCaptureOrganize(identity, session.id);
    return json({ session: getCaptureSession(identity, session.id) }, 201);
  });
}

async function serverTranscript(
  projectId: number,
  video: { filename: string; mime: string; buffer: Buffer },
  segments: Segment[]
) {
  const project = getDb()
    .prepare(
      `SELECT name, description, tech_stack, product_manager, experience_officer, agent_notes
       FROM projects WHERE id = ?`
    )
    .get(projectId) as
    | {
        name: string;
        description: string;
        tech_stack: string;
        product_manager: string;
        experience_officer: string;
        agent_notes: string;
      }
    | undefined;
  try {
    const heard = await transcribeSpeech(video, glossaryPrompt(project || {}));
    if (heard.available && heard.segments.length) return heard.segments;
  } catch {
    // 浏览器没听到时，服务端转写失败也不丢掉录像。
  }
  return segments;
}
