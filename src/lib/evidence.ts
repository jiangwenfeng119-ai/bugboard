import { BUG_BODY_MAX, BUG_TITLE_MAX } from "./limits";
import { parseStrokes, type Stroke } from "./strokes";

export type BugEvidenceInput = {
  quote?: unknown;
  steps?: unknown;
  evidenceSec?: unknown;
  strokes?: unknown;
  confidence?: unknown;
  openQuestion?: unknown;
  sourceUrl?: unknown;
  captureSessionId?: unknown;
  attachmentIds?: unknown;
};

export type BugEvidence = {
  quote: string;
  steps: string[];
  evidenceSec: number | null;
  strokes: Stroke[];
  confidence: "" | "low" | "ok";
  openQuestion: string;
  sourceUrl: string;
  captureSessionId: number | null;
  attachmentIds: number[];
};

function text(value: unknown, max: number, label: string) {
  if (value == null) return "";
  if (typeof value !== "string") throw new Error(`${label}无效`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new Error(`${label}过长`);
  return trimmed;
}

export function parseBugEvidence(input: BugEvidenceInput = {}): BugEvidence {
  const quote = text(input.quote, 4000, "原话");
  const openQuestion = text(input.openQuestion, 300, "待确认");
  const sourceUrl = text(input.sourceUrl, 500, "页面地址");
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) {
    throw new Error("页面地址无效");
  }

  let steps: string[] = [];
  try {
    if (typeof input.steps === "string" && input.steps.trim()) {
      steps = parseSteps(JSON.parse(input.steps) as unknown);
    } else if (input.steps != null && input.steps !== "") {
      steps = parseSteps(input.steps);
    }
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("步骤无效");
    throw error;
  }

  let evidenceSec: number | null = null;
  if (input.evidenceSec != null && input.evidenceSec !== "") {
    const value = Number(input.evidenceSec);
    if (!Number.isFinite(value) || value < 0 || value > 60 * 60 * 6) {
      throw new Error("时间点无效");
    }
    evidenceSec = Math.round(value * 10) / 10;
  }

  const confidenceRaw = text(input.confidence, 8, "置信度");
  if (confidenceRaw && confidenceRaw !== "low" && confidenceRaw !== "ok") {
    throw new Error("置信度无效");
  }

  let captureSessionId: number | null = null;
  if (input.captureSessionId != null && input.captureSessionId !== "") {
    const id = Number(input.captureSessionId);
    if (!Number.isInteger(id) || id <= 0) throw new Error("走查无效");
    captureSessionId = id;
  }

  let attachmentIds: number[] = [];
  if (input.attachmentIds != null && input.attachmentIds !== "") {
    const raw = Array.isArray(input.attachmentIds)
      ? input.attachmentIds
      : String(input.attachmentIds)
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean);
    attachmentIds = raw.map((item) => {
      const id = Number(item);
      if (!Number.isInteger(id) || id <= 0) throw new Error("附件无效");
      return id;
    });
    if (attachmentIds.length > 20) throw new Error("单条附件不能超过 20 个");
  }

  let strokes: Stroke[] = [];
  try {
    strokes = parseStrokes(input.strokes ?? []);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("圈选数据无效");
    throw error;
  }
  if (quote.length + openQuestion.length > BUG_BODY_MAX) {
    throw new Error(`描述不能超过 ${BUG_BODY_MAX} 字`);
  }
  return {
    quote,
    steps,
    evidenceSec,
    strokes,
    confidence: (confidenceRaw || "") as "" | "low" | "ok",
    openQuestion,
    sourceUrl,
    captureSessionId,
    attachmentIds,
  };
}

function parseSteps(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("步骤无效");
  if (value.length > 20) throw new Error("步骤过多");
  return value.map((item) => {
    if (typeof item !== "string") throw new Error("步骤无效");
    const step = item.trim();
    if (!step || step.length > 500) throw new Error("步骤无效");
    return step;
  });
}

export function evidenceTitleFits(title: string) {
  return title.trim().length > 0 && title.trim().length <= BUG_TITLE_MAX;
}
