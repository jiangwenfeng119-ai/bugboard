import type { Stroke } from "./strokes";

export type Segment = { start: number; end: number; text: string };

export type FrameMark = {
  index: number;
  t: number;
  note?: string;
  strokes?: Stroke[];
};

export type DraftSeed = {
  title: string;
  body: string;
  quote: string;
  spoken: string;
  steps: string[];
  evidenceSec: number | null;
  evidenceEnd: number | null;
  confidence: "" | "low" | "ok";
  question: string;
  strokes: Stroke[];
  frameIndex: number | null;
};

const LOW_QUESTION = "这句话不太完整，确认一下是不是要留。";
const GAP_SEC = 1.2;

function ensurePeriod(text: string) {
  const trimmed = text.trim();
  if (!trimmed || /[。！？.!?]$/.test(trimmed)) return trimmed;
  return /[\u4e00-\u9fff]/.test(trimmed) ? `${trimmed}。` : `${trimmed}.`;
}

/** Drop fillers and add a closing stop. If almost nothing remains, keep the raw line. */
export function polishUtterance(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  let next = trimmed
    .replace(/^(?:嗯+|啊+|呃+|那个|就是说)[，,\s]*/u, "")
    .replace(/(?:[，,\s])(?:嗯+|啊+|呃+|那个|就是说)(?=[，,\s。！？]|$)/gu, "")
    .replace(/(?:嗯|啊|呃){2,}/gu, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[，,\s]+/u, "")
    .replace(/[，,]{2,}/g, "，")
    .trim();
  const leftover = next.replace(/[。！？，,\s.!?]/g, "");
  const originalCore = trimmed.replace(/[。！？，,\s.!?]/g, "");
  if (leftover.length < 2 && originalCore.length >= 2) return trimmed;
  if (!next) return trimmed;
  return ensurePeriod(next);
}

function clipTitle(quote: string) {
  const bare = quote.replace(/[。！？.!?]$/u, "");
  const chars = Array.from(bare);
  return chars.slice(0, 42).join("") || "未命名现象";
}

function stepsFrom(quote: string) {
  const bare = quote.replace(/[。！？.!?]$/u, "");
  const parts = bare
    .split(/然后|接着/)
    .map((part) => part.trim().replace(/^[，,\s]+|[，,\s]+$/g, ""))
    .filter(Boolean);
  return parts.length >= 2 ? parts : [];
}

function spokenBody(quote: string, spoken: string, steps: string[], question: string) {
  const blocks: string[] = [];
  if (spoken && spoken !== quote) {
    blocks.push("## 原话", spoken);
  }
  if (steps.length) {
    blocks.push("## 复现步骤", steps.map((step, index) => `${index + 1}. ${step}`).join("\n"));
  }
  if (question) blocks.push("## 待确认", question);
  return blocks.join("\n\n");
}

function makeSeed(parts: string[], start: number, end: number): DraftSeed {
  const quote = ensurePeriod(parts.filter(Boolean).join("，"));
  const steps = stepsFrom(quote);
  const bare = quote.replace(/[。！？.!?]$/u, "");
  const low = Array.from(bare).length < 8;
  const question = low ? LOW_QUESTION : "";
  const confidence = low ? "low" : "ok";
  return {
    title: clipTitle(quote),
    quote,
    spoken: quote,
    steps,
    evidenceSec: start,
    evidenceEnd: end,
    confidence,
    question,
    strokes: [],
    frameIndex: null,
    body: spokenBody(quote, quote, steps, question),
  };
}

function applyText(seed: DraftSeed, text: string, keepTime: boolean) {
  const quote = polishUtterance(text);
  const steps = stepsFrom(quote);
  const bare = quote.replace(/[。！？.!?]$/u, "");
  const low = Array.from(bare).length < 8;
  const question = low ? LOW_QUESTION : "";
  seed.title = clipTitle(quote);
  seed.quote = quote;
  seed.spoken = quote;
  seed.steps = steps;
  seed.confidence = low ? "low" : "ok";
  seed.question = question;
  seed.body = spokenBody(quote, quote, steps, question);
  if (!keepTime) {
    seed.evidenceSec = null;
    seed.evidenceEnd = null;
  }
}

const BARE_RETRACT = /^(?:不对|算了|不要了|取消)[。！]?$/u;
const CORRECTION = /^(?:不对|不是)[，,]?\s*是(.+)$/u;

type OpenCluster = { parts: string[]; start: number; end: number };

export function splitTranscript(segments: Segment[], frames: FrameMark[] = []): DraftSeed[] {
  const ordered = [...segments].sort((a, b) => a.start - b.start);
  const drafts: DraftSeed[] = [];
  let current: OpenCluster | null = null;

  function flush() {
    if (!current || current.parts.length === 0) {
      current = null;
      return;
    }
    drafts.push(makeSeed(current.parts, current.start, current.end));
    current = null;
  }

  for (const segment of ordered) {
    const text = segment.text.trim();
    if (!text) continue;
    if (BARE_RETRACT.test(text)) {
      current = null;
      drafts.pop();
      continue;
    }
    const correction = text.match(CORRECTION);
    if (correction) {
      if (current) {
        current.parts = [correction[1].trim()];
        current.end = segment.end;
      } else if (drafts.length) {
        const last = drafts[drafts.length - 1];
        applyText(last, correction[1], true);
        last.evidenceEnd = segment.end;
      } else {
        current = { parts: [correction[1].trim()], start: segment.start, end: segment.end };
      }
      continue;
    }
    const polished = polishUtterance(text).replace(/[。！？.!?]$/u, "");
    if (!polished) continue;
    const gap = current ? segment.start - current.end : 0;
    if (current && gap > GAP_SEC) flush();
    if (!current) current = { parts: [], start: segment.start, end: segment.end };
    current.parts.push(polished);
    current.end = segment.end;
  }
  flush();

  assignFrames(drafts, frames);
  return drafts;
}

function covers(seed: DraftSeed, t: number) {
  if (seed.evidenceSec == null) return false;
  const end = seed.evidenceEnd ?? seed.evidenceSec;
  return t >= seed.evidenceSec - 0.5 && t <= end + 0.8;
}

function applyFrame(seed: DraftSeed, frame: FrameMark) {
  seed.frameIndex = frame.index;
  seed.strokes = frame.strokes || [];
  const note = frame.note?.trim();
  if (!note) return;
  const spoken = seed.spoken;
  const quote = polishUtterance(note);
  const steps = stepsFrom(quote);
  const bare = quote.replace(/[。！？.!?]$/u, "");
  const low = Array.from(bare).length < 8;
  const question = low ? LOW_QUESTION : "";
  seed.quote = quote;
  seed.title = clipTitle(quote);
  seed.steps = steps;
  seed.confidence = low ? "low" : "ok";
  seed.question = question;
  seed.body = spokenBody(quote, spoken, steps, question);
}

function nearest(drafts: DraftSeed[], t: number) {
  let best: { seed: DraftSeed; dist: number } | null = null;
  for (const seed of drafts) {
    if (seed.evidenceSec == null) continue;
    const end = seed.evidenceEnd ?? seed.evidenceSec;
    const dist = t < seed.evidenceSec ? seed.evidenceSec - t : t > end ? t - end : 0;
    if (!best || dist < best.dist) best = { seed, dist };
  }
  return best && best.dist <= 5 ? best.seed : null;
}

function assignFrames(drafts: DraftSeed[], frames: FrameMark[]) {
  const extras: DraftSeed[] = [];
  for (const frame of [...frames].sort((a, b) => a.t - b.t)) {
    const hit = drafts.find((seed) => covers(seed, frame.t) && seed.frameIndex == null);
    if (hit) {
      applyFrame(hit, frame);
      continue;
    }
    const occupied = drafts.find((seed) => covers(seed, frame.t));
    if (occupied && frame.note?.trim()) {
      extras.push(frameSeed(frame));
      continue;
    }
    const close = nearest([...drafts, ...extras], frame.t);
    if (close && close.frameIndex == null) {
      applyFrame(close, frame);
      continue;
    }
    extras.push(frameSeed(frame));
  }
  drafts.push(...extras);
  drafts.sort((a, b) => (a.evidenceSec ?? 0) - (b.evidenceSec ?? 0));
}

function frameSeed(frame: FrameMark): DraftSeed {
  const note = frame.note?.trim() || "截了一张图";
  const quote = polishUtterance(note);
  const steps = stepsFrom(quote);
  const bare = quote.replace(/[。！？.!?]$/u, "");
  const low = Array.from(bare).length < 8;
  const question = low ? LOW_QUESTION : "";
  return {
    title: clipTitle(quote),
    quote,
    spoken: quote,
    steps,
    evidenceSec: frame.t,
    evidenceEnd: frame.t,
    confidence: low ? "low" : "ok",
    question,
    strokes: frame.strokes || [],
    frameIndex: frame.index,
    body: spokenBody(quote, quote, steps, question),
  };
}
