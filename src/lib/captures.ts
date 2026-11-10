import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import { actorFromIdentity } from "./auth";
import { getDb, nowIso } from "./db";
import { parseBugEvidence } from "./evidence";
import { BUG_TITLE_MAX } from "./limits";
import { uploadsRoot } from "./paths";
import { canAccessProject } from "./permissions";
import type { Stroke } from "./strokes";
import { splitTranscript, type DraftSeed, type FrameMark, type Segment } from "./transcript";
import type { Identity } from "./types";
import { absoluteAttachmentPath, assertAllowedUpload, saveUploadedFile } from "./uploads";

export type CaptureFrameInput = {
  t: number;
  note?: string;
  filename: string;
  mime: string;
  buffer: Buffer;
  strokes?: Stroke[];
};

type SessionRow = {
  id: number;
  project_id: number;
  author_type: "user" | "api_key";
  author_id: number;
  status: "review" | "done";
  title: string;
  transcript_json: string;
  duration_sec: number | null;
  truncated: number;
  video_filename: string | null;
  video_mime: string | null;
  video_size: number | null;
  video_path: string | null;
  created_at: string;
  updated_at: string;
  organize_status?: string;
  organize_detail?: string;
  organize_started_at?: string | null;
};

type DraftRow = {
  id: number;
  session_id: number;
  sort_index: number;
  title: string;
  body: string;
  quote: string;
  steps_json: string;
  evidence_sec: number | null;
  confidence: string;
  question: string;
  strokes_json: string;
  status: "draft" | "kept" | "discarded" | "merged";
  merged_into_id: number | null;
  bug_id: number | null;
  frame_filename: string | null;
  frame_mime: string | null;
  frame_size: number | null;
  frame_path: string | null;
  created_at: string;
  updated_at: string;
};

export type DraftUpdate = {
  id: number;
  title: string;
  body: string;
  quote: string;
  steps: string[];
  question: string;
  status: DraftRow["status"];
  mergedIntoId?: number | null;
};

function writeCaptureFile(sessionId: number, filename: string, buffer: Buffer) {
  assertAllowedUpload(filename, buffer.length);
  const safeName = filename.replace(/[^\w.\-\u4e00-\u9fff]+/g, "_");
  const rel = path.join("captures", String(sessionId), `${nanoid(8)}_${safeName}`);
  const abs = path.join(uploadsRoot(), rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buffer);
  return rel;
}

function draftView(row: DraftRow) {
  return {
    id: row.id,
    sortIndex: row.sort_index,
    title: row.title,
    body: row.body,
    quote: row.quote,
    steps: JSON.parse(row.steps_json) as string[],
    evidenceSec: row.evidence_sec,
    confidence: row.confidence,
    question: row.question,
    strokes: JSON.parse(row.strokes_json) as Stroke[],
    status: row.status,
    mergedIntoId: row.merged_into_id,
    bugId: row.bug_id,
    frameUrl: row.frame_path ? `/api/captures/${row.session_id}/frames/${row.id}` : null,
    frameFilename: row.frame_filename,
  };
}

function sessionView(row: SessionRow, drafts: DraftRow[]) {
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    title: row.title,
    durationSec: row.duration_sec,
    truncated: row.truncated === 1,
    transcript: JSON.parse(row.transcript_json) as Segment[],
    videoUrl: row.video_path ? `/api/captures/${row.id}/video` : null,
    videoFilename: row.video_filename,
    organizeStatus: row.organize_status || "ready",
    organizeDetail: row.organize_detail || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    drafts: drafts.map(draftView),
  };
}

const ORGANIZE_WAIT_MS = 8 * 60 * 1000;

function settleOrganize(row: SessionRow) {
  if (row.organize_status !== "organizing" || !row.organize_started_at) return row;
  if (Date.now() - Date.parse(row.organize_started_at) < ORGANIZE_WAIT_MS) return row;
  const detail = "整理超时，先用规则草稿";
  getDb()
    .prepare(
      `UPDATE capture_sessions
       SET organize_status = 'failed', organize_detail = ?, updated_at = ?
       WHERE id = ? AND organize_status = 'organizing'`
    )
    .run(detail, nowIso(), row.id);
  return { ...row, organize_status: "failed", organize_detail: detail };
}

function loadSession(identity: Identity, sessionId: number) {
  const found = getDb().prepare("SELECT * FROM capture_sessions WHERE id = ?").get(sessionId) as
    | SessionRow
    | undefined;
  if (!found) throw new Error("走查不存在");
  const row = settleOrganize(found);
  getProjectForCapture(identity, row.project_id);
  const drafts = getDb()
    .prepare("SELECT * FROM capture_drafts WHERE session_id = ? ORDER BY sort_index, id")
    .all(sessionId) as DraftRow[];
  return { row, drafts };
}

const UNHEARD_QUESTION = "没有识别到话。看录像，把现象写进标题后再留下。";

/** Speech can fail while the recording is real. Keep one draft the person can write. */
export function draftsFromCapture(
  transcript: Segment[],
  marks: FrameMark[],
  source: { hasVideo: boolean; durationSec: number | null }
): DraftSeed[] {
  const seeds = splitTranscript(transcript, marks);
  if (seeds.length || !source.hasVideo) return seeds;
  return [
    {
      title: "这段走查",
      body: "",
      quote: "",
      spoken: "",
      steps: [],
      evidenceSec: 0,
      evidenceEnd: source.durationSec,
      confidence: "low",
      question: UNHEARD_QUESTION,
      strokes: [],
      frameIndex: null,
    },
  ];
}

function getProjectForCapture(identity: Identity, projectId: number) {
  const project = getDb().prepare("SELECT id FROM projects WHERE id = ?").get(projectId);
  if (!project) throw new Error("项目不存在");
  if (!canAccessProject(identity, projectId)) throw new Error("无权访问该项目");
}

export function createCaptureSession(
  identity: Identity,
  projectId: number,
  input: {
    transcript: Segment[];
    durationSec?: number | null;
    truncated?: boolean;
    video?: { filename: string; mime: string; buffer: Buffer } | null;
    frames?: CaptureFrameInput[];
  }
) {
  getProjectForCapture(identity, projectId);
  const frames = input.frames || [];
  if (!input.transcript.length && !frames.length && !input.video) {
    throw new Error("走查是空的");
  }
  const marks: FrameMark[] = frames.map((frame, index) => ({
    index,
    t: frame.t,
    note: frame.note,
    strokes: frame.strokes,
  }));
  const seeds = draftsFromCapture(input.transcript, marks, {
    hasVideo: Boolean(input.video?.buffer.length),
    durationSec: input.durationSec ?? null,
  });
  if (!seeds.length) throw new Error("没有整理出草稿");
  const actor = actorFromIdentity(identity);
  const t = nowIso();
  const title = seeds[0]?.title || "走查";
  const db = getDb();
  const sessionId = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO capture_sessions (
           project_id, author_type, author_id, status, title, transcript_json,
           duration_sec, truncated, organize_status, created_at, updated_at
         ) VALUES (?, ?, ?, 'review', ?, ?, ?, ?, 'idle', ?, ?)`
      )
      .run(
        projectId,
        actor.actorType,
        actor.actorId,
        title,
        JSON.stringify(input.transcript),
        input.durationSec ?? null,
        input.truncated ? 1 : 0,
        t,
        t
      );
    return Number(info.lastInsertRowid);
  })();

  if (input.video && input.video.buffer.length) {
    const rel = writeCaptureFile(sessionId, input.video.filename, input.video.buffer);
    db.prepare(
      `UPDATE capture_sessions
       SET video_filename = ?, video_mime = ?, video_size = ?, video_path = ?
       WHERE id = ?`
    ).run(input.video.filename, input.video.mime, input.video.buffer.length, rel, sessionId);
  }

  const insertDraft = db.prepare(
    `INSERT INTO capture_drafts (
       session_id, sort_index, title, body, quote, steps_json, evidence_sec, confidence,
       question, strokes_json, status, frame_filename, frame_mime, frame_size, frame_path,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`
  );
  seeds.forEach((seed, index) => {
    const frame = seed.frameIndex == null ? null : frames[seed.frameIndex];
    let framePath: string | null = null;
    if (frame) framePath = writeCaptureFile(sessionId, frame.filename, frame.buffer);
    insertDraft.run(
      sessionId,
      index,
      seed.title.slice(0, BUG_TITLE_MAX),
      seed.body,
      seed.quote,
      JSON.stringify(seed.steps),
      seed.evidenceSec,
      seed.confidence,
      seed.question,
      JSON.stringify(seed.strokes),
      frame?.filename ?? null,
      frame ? frame.mime : null,
      frame ? frame.buffer.length : null,
      framePath,
      t,
      t
    );
  });
  return getCaptureSession(identity, sessionId);
}

export function listCaptureSessions(identity: Identity, projectId: number) {
  getProjectForCapture(identity, projectId);
  const rows = getDb()
    .prepare(
      `SELECT s.*, (
         SELECT COUNT(*) FROM capture_drafts d
         WHERE d.session_id = s.id AND d.status IN ('draft','kept')
       ) AS open_count
       FROM capture_sessions s
       WHERE s.project_id = ?
       ORDER BY s.id DESC`
    )
    .all(projectId) as (SessionRow & { open_count: number })[];
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    openCount: row.open_count,
    truncated: row.truncated === 1,
    createdAt: row.created_at,
    video: Boolean(row.video_path),
  }));
}

export function getCaptureSession(identity: Identity, sessionId: number) {
  const { row, drafts } = loadSession(identity, sessionId);
  return sessionView(row, drafts);
}

export function captureMediaPath(
  identity: Identity,
  sessionId: number,
  kind: "video" | "frame",
  draftId?: number
) {
  const { row, drafts } = loadSession(identity, sessionId);
  if (kind === "video") {
    if (!row.video_path || !row.video_filename) throw new Error("没有录像");
    return { path: row.video_path, filename: row.video_filename };
  }
  const draft = drafts.find((item) => item.id === draftId);
  if (!draft?.frame_path || !draft.frame_filename) throw new Error("没有这张截图");
  return { path: draft.frame_path, filename: draft.frame_filename };
}

export type ReplacementDraft = {
  title: string;
  body?: string;
  quote?: string;
  steps?: string[];
  evidenceSec?: number | null;
  confidence?: string;
  question?: string;
  frameDraftId?: number | null;
};

export function replaceCaptureDrafts(identity: Identity, sessionId: number, incoming: ReplacementDraft[]) {
  const { row, drafts } = loadSession(identity, sessionId);
  if (row.status !== "review") throw new Error("这次走查已经整理完");
  if (row.organize_status !== "organizing") throw new Error("这次整理已经结束");
  if (drafts.some((draft) => draft.status !== "draft")) throw new Error("人已经开始审核");
  if (!incoming.length || incoming.length > 20) throw new Error("草稿数量无效");
  const frames = new Map(drafts.filter((draft) => draft.frame_path).map((draft) => [draft.id, draft]));
  const usedFrames = new Set<number>();
  const next = incoming.map((item, index) => {
    const title = item.title.trim();
    if (!title || title.length > BUG_TITLE_MAX) throw new Error("标题必填");
    const evidence = parseBugEvidence({
      quote: item.quote,
      steps: item.steps,
      evidenceSec: item.evidenceSec,
      openQuestion: item.question,
      confidence: item.confidence,
    });
    let frame: DraftRow | undefined;
    if (item.frameDraftId != null) {
      const id = Number(item.frameDraftId);
      frame = frames.get(id);
      if (!frame || usedFrames.has(id)) throw new Error("截图无效");
      usedFrames.add(id);
    }
    return { index, title, evidence, frame, body: (item.body || "").slice(0, 8000) };
  });
  const t = nowIso();
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM capture_drafts WHERE session_id = ?").run(sessionId);
    const insert = db.prepare(
      `INSERT INTO capture_drafts (
         session_id, sort_index, title, body, quote, steps_json, evidence_sec, confidence,
         question, strokes_json, status, frame_filename, frame_mime, frame_size, frame_path,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'draft', ?, ?, ?, ?, ?, ?)`
    );
    for (const item of next) {
      insert.run(
        sessionId,
        item.index,
        item.title,
        item.body,
        item.evidence.quote,
        JSON.stringify(item.evidence.steps),
        item.evidence.evidenceSec,
        item.evidence.confidence,
        item.evidence.openQuestion,
        item.frame?.frame_filename ?? null,
        item.frame?.frame_mime ?? null,
        item.frame?.frame_size ?? null,
        item.frame?.frame_path ?? null,
        t,
        t
      );
    }
    db.prepare(
      `UPDATE capture_sessions
       SET organize_status = 'ready', organize_detail = '', updated_at = ?
       WHERE id = ?`
    ).run(t, sessionId);
  })();
  return getCaptureSession(identity, sessionId);
}

export function skipCaptureOrganize(identity: Identity, sessionId: number) {
  const { row } = loadSession(identity, sessionId);
  if (row.status !== "review") throw new Error("这次走查已经整理完");
  if (row.organize_status !== "organizing") return getCaptureSession(identity, sessionId);
  getDb()
    .prepare(
      `UPDATE capture_sessions
       SET organize_status = 'skipped', organize_detail = '改用规则草稿', updated_at = ?
       WHERE id = ?`
    )
    .run(nowIso(), sessionId);
  return getCaptureSession(identity, sessionId);
}

export function saveCaptureReview(identity: Identity, sessionId: number, updates: DraftUpdate[]) {
  const { row, drafts } = loadSession(identity, sessionId);
  if (row.status !== "review") throw new Error("这次走查已经整理完");
  if (row.organize_status === "organizing") throw new Error("本机 agent 还在整理");
  const byId = new Map(drafts.map((draft) => [draft.id, draft]));
  if (updates.length !== drafts.length) throw new Error("草稿不完整");
  const seen = new Set<number>();
  for (const update of updates) {
    if (seen.has(update.id) || !byId.has(update.id)) throw new Error("草稿无效");
    seen.add(update.id);
    if (!["draft", "kept", "discarded", "merged"].includes(update.status)) {
      throw new Error("草稿状态无效");
    }
    if (!update.title.trim() || update.title.trim().length > BUG_TITLE_MAX) {
      throw new Error("标题必填");
    }
    if (update.status === "merged") {
      const target = update.mergedIntoId == null ? null : byId.get(update.mergedIntoId);
      if (!target || target.id === update.id) throw new Error("没有可并入的上一条");
    }
  }
  const t = nowIso();
  const db = getDb();
  db.transaction(() => {
    for (const update of updates) {
      const evidence = parseBugEvidence({
        quote: update.quote,
        steps: update.steps,
        openQuestion: update.question,
      });
      db.prepare(
        `UPDATE capture_drafts
         SET title = ?, body = ?, quote = ?, steps_json = ?, question = ?, status = ?,
             merged_into_id = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        update.title.trim(),
        update.body || "",
        evidence.quote,
        JSON.stringify(evidence.steps),
        evidence.openQuestion,
        update.status,
        update.status === "merged" ? update.mergedIntoId : null,
        t,
        update.id
      );
    }
    moveMergedFrames(db, drafts, updates);
    db.prepare("UPDATE capture_sessions SET updated_at = ? WHERE id = ?").run(t, sessionId);
  })();
  return getCaptureSession(identity, sessionId);
}

function moveMergedFrames(db: ReturnType<typeof getDb>, drafts: DraftRow[], updates: DraftUpdate[]) {
  if (!drafts.length) return;
  const fresh = new Map(
    (
      db.prepare("SELECT * FROM capture_drafts WHERE session_id = ?").all(drafts[0]?.session_id) as DraftRow[]
    ).map((row) => [row.id, row])
  );
  for (const update of updates) {
    if (update.status !== "merged" || update.mergedIntoId == null) continue;
    const source = fresh.get(update.id);
    const target = fresh.get(update.mergedIntoId);
    if (!source?.frame_path || !target || target.frame_path) continue;
    db.prepare(
      `UPDATE capture_drafts
       SET frame_filename = ?, frame_mime = ?, frame_size = ?, frame_path = ?, strokes_json = ?
       WHERE id = ?`
    ).run(
      source.frame_filename,
      source.frame_mime,
      source.frame_size,
      source.frame_path,
      source.strokes_json,
      target.id
    );
    db.prepare(
      `UPDATE capture_drafts
       SET frame_filename = NULL, frame_mime = NULL, frame_size = NULL, frame_path = NULL
       WHERE id = ?`
    ).run(source.id);
  }
}

export async function commitCaptureSession(
  identity: Identity,
  sessionId: number,
  updates?: DraftUpdate[]
) {
  if (updates) saveCaptureReview(identity, sessionId, updates);
  const { row, drafts } = loadSession(identity, sessionId);
  if (row.status !== "review") throw new Error("这次走查已经整理完");
  if (row.organize_status === "organizing") throw new Error("本机 agent 还在整理");
  if (drafts.some((draft) => draft.status === "draft")) {
    throw new Error("还有没看过的草稿");
  }
  const kept = drafts.filter((draft) => draft.status === "kept");
  const { createBug } = await import("./services");
  const bugs = [];
  for (const draft of kept) {
    const bug = createBug(identity, {
      projectId: row.project_id,
      title: draft.title,
      body: draft.body,
      priority: "p2",
      evidence: {
        quote: draft.quote,
        steps: JSON.parse(draft.steps_json) as string[],
        evidenceSec: draft.evidence_sec,
        strokes: JSON.parse(draft.strokes_json) as Stroke[],
        confidence: draft.confidence,
        openQuestion: draft.question,
        captureSessionId: row.id,
      },
    });
    if (draft.frame_path && draft.frame_filename) {
      const buffer = fs.readFileSync(absoluteAttachmentPath(draft.frame_path));
      saveUploadedFile({
        ownerType: "bug",
        ownerId: bug.id,
        filename: draft.frame_filename,
        mime: draft.frame_mime || "image/png",
        buffer,
      });
    }
    getDb().prepare("UPDATE capture_drafts SET bug_id = ? WHERE id = ?").run(bug.id, draft.id);
    bugs.push(bug);
  }
  getDb()
    .prepare("UPDATE capture_sessions SET status = 'done', updated_at = ? WHERE id = ?")
    .run(nowIso(), sessionId);
  return { session: getCaptureSession(identity, sessionId), bugs };
}

export function captureFilePathsForProject(projectId: number) {
  const db = getDb();
  const videos = db
    .prepare(
      "SELECT video_path AS storage_path FROM capture_sessions WHERE project_id = ? AND video_path IS NOT NULL"
    )
    .all(projectId) as { storage_path: string }[];
  const frames = db
    .prepare(
      `SELECT d.frame_path AS storage_path
       FROM capture_drafts d
       JOIN capture_sessions s ON s.id = d.session_id
       WHERE s.project_id = ? AND d.frame_path IS NOT NULL`
    )
    .all(projectId) as { storage_path: string }[];
  const staged = db
    .prepare("SELECT storage_path FROM staged_uploads WHERE project_id = ?")
    .all(projectId) as { storage_path: string }[];
  return [...videos, ...frames, ...staged];
}
