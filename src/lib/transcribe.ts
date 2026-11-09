import type { Segment } from "./transcript";

export function asrConfigured() {
  return Boolean(process.env.ASR_BASE_URL && process.env.ASR_API_KEY);
}

type Verbose = {
  text?: string;
  segments?: { start?: number; end?: number; text?: string }[];
};

/** Server transcript when ASR_BASE_URL points at an OpenAI-compatible speech API. */
export async function transcribeSpeech(
  file: { filename: string; mime: string; buffer: Buffer },
  prompt: string
): Promise<{ available: false } | { available: true; text: string; segments: Segment[] }> {
  const base = process.env.ASR_BASE_URL?.replace(/\/$/, "");
  const key = process.env.ASR_API_KEY;
  if (!base || !key) return { available: false };

  const form = new FormData();
  form.set("model", process.env.ASR_MODEL || "whisper-1");
  form.set("response_format", "verbose_json");
  if (prompt) form.set("prompt", prompt.slice(0, 800));
  form.set("file", new Blob([new Uint8Array(file.buffer)], { type: file.mime || "audio/webm" }), file.filename);

  const res = await fetch(`${base}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error("转写失败");
  }
  const data = (await res.json()) as Verbose;
  const text = (data.text || "").trim();
  const segments: Segment[] = (data.segments || [])
    .map((segment) => ({
      start: Number(segment.start) || 0,
      end: Number(segment.end) || 0,
      text: (segment.text || "").trim(),
    }))
    .filter((segment) => segment.text);
  if (!segments.length && text) segments.push({ start: 0, end: 0, text });
  return { available: true, text, segments };
}
