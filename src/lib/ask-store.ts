import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import fs from "fs";
import path from "path";
import { actorFromIdentity } from "./auth";
import {
  ASK_MAP_QUESTION,
  answerWithoutJudgment,
  applyAskCallback,
  assertQuestion,
  assertThreadId,
  buildAskPrompt,
  documentExcerpt,
  emptyAskView,
  normalizeQuestion,
  wakeFailureText,
  type AskJudgment,
  type AskStatus,
  type AskView,
} from "./ask-core";
import { askImageToken, takeAskImages } from "./ask-images";
import { readBehavior } from "./behavior";
import { getDb, nowIso } from "./db";
import { canAccessProject } from "./permissions";
import { uploadsRoot } from "./paths";
import { getProject } from "./services";
import type { Identity } from "./types";
import { absoluteAttachmentPath } from "./uploads";

export type PublicAsk = {
  id: number;
  question: string;
  status: AskStatus;
  judgment: AskJudgment;
  answer: string;
  statusLine: string;
  error: string;
  cached: boolean;
  updatedAt: string;
};

type AskRow = {
  id: number;
  project_id: number;
  actor_type: "user" | "api_key";
  actor_id: number;
  thread_id: string;
  question: string;
  question_norm: string;
  status: AskStatus;
  judgment: string;
  answer: string;
  status_line: string;
  mirror_sha: string;
  cached_from_id: number | null;
  session_id: string;
  seq: number;
  error: string;
  force: number;
  created_at: string;
  updated_at: string;
};

const NO_REPO = "这个项目还没有代码仓，请直接写报障";
const OFFLINE = "代码机暂时不在，可以先写报障";

let askFetch: typeof fetch = globalThis.fetch;

export function setAskFetchForTests(fn: typeof fetch | null) {
  askFetch = fn || globalThis.fetch;
}

function sign(secret: string, body: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function signaturesMatch(secret: string, body: string, header: string) {
  const got = Buffer.from(String(header || "").replace(/^sha256=/, ""));
  const expected = Buffer.from(sign(secret, body));
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export function toPublicAsk(row: AskRow): PublicAsk {
  return {
    id: row.id,
    question: row.question,
    status: row.status,
    judgment: row.judgment === "exists" || row.judgment === "file" || row.judgment === "unsure" ? row.judgment : "",
    answer: row.answer,
    statusLine: row.status_line,
    error: row.error,
    cached: row.cached_from_id != null,
    updatedAt: row.updated_at,
  };
}

function viewFrom(row: AskRow): AskView {
  return {
    seq: row.seq,
    status: row.status,
    answer: row.answer,
    statusLine: row.status_line,
    error: row.error,
    sessionId: row.session_id,
    mirrorSha: row.mirror_sha,
    judgment: row.judgment === "exists" || row.judgment === "file" || row.judgment === "unsure" ? row.judgment : "",
  };
}

function saveView(id: number, view: AskView) {
  getDb()
    .prepare(
      `UPDATE ask_runs
       SET status = ?, judgment = ?, answer = ?, status_line = ?, mirror_sha = ?,
           session_id = ?, seq = ?, error = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      view.status,
      view.judgment,
      view.answer,
      view.statusLine,
      view.mirrorSha,
      view.sessionId,
      view.seq,
      view.error,
      nowIso(),
      id
    );
}

function rememberMirror(projectId: number, sha: string, status: string, detail: string) {
  getDb()
    .prepare(
      `INSERT INTO ask_mirrors (project_id, head_sha, branch, status, detail, updated_at)
       VALUES (?, ?, '', ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         head_sha = excluded.head_sha,
         status = excluded.status,
         detail = excluded.detail,
         updated_at = excluded.updated_at`
    )
    .run(projectId, sha, status, detail.slice(0, 300), nowIso());
}

function insertRun(input: {
  projectId: number;
  actorType: "user" | "api_key";
  actorId: number;
  threadId: string;
  question: string;
  status: AskStatus;
  error?: string;
  force?: boolean;
  sessionId?: string;
}) {
  const now = nowIso();
  const result = getDb()
    .prepare(
      `INSERT INTO ask_runs (
         project_id, actor_type, actor_id, thread_id, question, question_norm, status,
         error, force, session_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.projectId,
      input.actorType,
      input.actorId,
      input.threadId,
      input.question,
      normalizeQuestion(input.question),
      input.status,
      input.error || "",
      input.force ? 1 : 0,
      input.sessionId || "",
      now,
      now
    );
  const row = getRun(Number(result.lastInsertRowid));
  if (!row) throw new Error("这次提问不存在");
  return row;
}

function getRun(id: number) {
  return getDb().prepare("SELECT * FROM ask_runs WHERE id = ?").get(id) as AskRow | undefined;
}

export function readAsk(identity: Identity, projectId: number, runId: number) {
  if (!canAccessProject(identity, projectId)) throw new Error("无权访问该项目");
  const row = getRun(runId);
  if (!row || row.project_id !== projectId) throw new Error("这次提问不存在");
  const actor = actorFromIdentity(identity);
  if (row.actor_type !== actor.actorType || row.actor_id !== actor.actorId) throw new Error("这次提问不存在");
  return toPublicAsk(row);
}

function cachedAnswer(row: AskRow, sha: string) {
  if (!sha || row.force) return undefined;
  return getDb()
    .prepare(
      `SELECT * FROM ask_runs
       WHERE project_id = ? AND question_norm = ? AND mirror_sha = ? AND status = 'done' AND id != ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(row.project_id, row.question_norm, sha, row.id) as AskRow | undefined;
}

function copyCache(row: AskRow, hit: AskRow, sha: string) {
  getDb()
    .prepare(
      `UPDATE ask_runs
       SET status = 'done', judgment = ?, answer = ?, status_line = '', mirror_sha = ?,
           cached_from_id = ?, session_id = ?, error = '', updated_at = ?
       WHERE id = ?`
    )
    .run(hit.judgment, hit.answer, sha, hit.id, hit.session_id, nowIso(), row.id);
}

export function acceptAskCallback(raw: string, header: string) {
  let body: {
    runId?: number;
    seq?: number;
    kind?: string;
    text?: string;
    sessionId?: string;
    mirrorSha?: string;
  };
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error("不是 JSON");
  }
  const runId = Number(body.runId);
  const row = getRun(runId);
  if (!row) throw new Error("这次提问不存在");
  const secret = (
    getDb().prepare("SELECT webhook_secret FROM project_dispatch WHERE project_id = ?").get(row.project_id) as
      | { webhook_secret: string }
      | undefined
  )?.webhook_secret;
  if (!secret || !signaturesMatch(secret, raw, header)) throw new Error("签名不对");
  const sha = typeof body.mirrorSha === "string" ? body.mirrorSha : "";
  if (body.kind === "probe") {
    if (row.status !== "streaming") return { skip: true };
    if (sha) rememberMirror(row.project_id, sha, "ready", "");
    const hit = cachedAnswer(row, sha);
    if (hit) {
      copyCache(row, hit, sha);
      return { skip: true };
    }
    if (sha) {
      getDb().prepare("UPDATE ask_runs SET mirror_sha = ?, updated_at = ? WHERE id = ?").run(sha, nowIso(), row.id);
    }
    return { skip: false };
  }
  if (body.kind !== "delta" && body.kind !== "status" && body.kind !== "done" && body.kind !== "reverted" && body.kind !== "failed") {
    throw new Error("不认识的回答事件");
  }
  const current = getRun(runId);
  if (!current) throw new Error("这次提问不存在");
  const next = applyAskCallback(viewFrom(current), {
    seq: Number(body.seq),
    kind: body.kind,
    text: typeof body.text === "string" ? body.text : "",
    sessionId: typeof body.sessionId === "string" ? body.sessionId : "",
    mirrorSha: sha,
  });
  saveView(runId, next);
  if (next.mirrorSha) rememberMirror(row.project_id, next.mirrorSha, next.status === "failed" ? "failed" : "ready", next.error);
  if (next.status === "done" && normalizeQuestion(current.question) === normalizeQuestion(ASK_MAP_QUESTION)) {
    getDb()
      .prepare(
        `INSERT INTO ask_maps (project_id, body, mirror_sha, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
           body = excluded.body,
           mirror_sha = excluded.mirror_sha,
           updated_at = excluded.updated_at`
      )
      .run(row.project_id, answerWithoutJudgment(next.answer), next.mirrorSha, nowIso());
  }
  return { skip: false };
}

export function stopAsk(identity: Identity, projectId: number, runId: number) {
  const current = readAsk(identity, projectId, runId);
  if (current.status !== "streaming") return current;
  const row = getRun(runId);
  if (!row) throw new Error("这次提问不存在");
  saveView(runId, applyAskCallback(viewFrom(row), { seq: row.seq + 1, kind: "failed", text: "已停止" }));
  return readAsk(identity, projectId, runId);
}

function attachmentBuffers(projectId: number, ids: number[]) {
  const files: { filename: string; buffer: Buffer }[] = [];
  const stmt = getDb().prepare(
    `SELECT a.filename, a.storage_path
     FROM attachments a
     LEFT JOIN bugs b ON a.owner_type = 'bug' AND a.owner_id = b.id
     LEFT JOIN bug_status_events e ON a.owner_type = 'status_event' AND a.owner_id = e.id
     LEFT JOIN bugs eb ON e.bug_id = eb.id
     WHERE a.id = ? AND (b.project_id = ? OR eb.project_id = ?)`
  );
  for (const id of ids) {
    if (!Number.isInteger(id) || id <= 0) continue;
    const row = stmt.get(id, projectId, projectId) as { filename: string; storage_path: string } | undefined;
    if (!row) continue;
    try {
      files.push({ filename: row.filename, buffer: fs.readFileSync(absoluteAttachmentPath(row.storage_path)) });
    } catch {
      // 缺文件就跳过
    }
  }
  return files;
}

function saveAskImageFiles(runId: number, files: { filename: string; buffer: Buffer }[]) {
  const dir = path.join(uploadsRoot(), "ask", String(runId));
  fs.mkdirSync(dir, { recursive: true });
  const names: string[] = [];
  for (const file of files) {
    const ext = path.extname(file.filename).toLowerCase();
    const name = `${randomBytes(6).toString("hex")}${ext}`;
    fs.writeFileSync(path.join(dir, name), file.buffer);
    names.push(name);
  }
  return names;
}

export async function startAsk(
  identity: Identity,
  projectId: number,
  input: {
    question: string;
    threadId: string;
    force?: boolean;
    draft?: string;
    images?: { filename: string; buffer: Buffer }[];
    attachmentIds?: number[];
  },
  callbackUrl: string
) {
  if (!canAccessProject(identity, projectId)) throw new Error("无权访问该项目");
  const project = getProject(identity, projectId);
  const question = assertQuestion(input.question);
  const threadId = assertThreadId(input.threadId);
  const actor = actorFromIdentity(identity);
  const settings = readBehavior(projectId);
  if (!settings.askEnabled) throw new Error("这个项目还没打开问答");
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const used = getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM ask_runs
       WHERE project_id = ? AND actor_type = ? AND actor_id = ? AND created_at >= ?`
    )
    .get(projectId, actor.actorType, actor.actorId, since) as { c: number };
  if (used.c >= settings.askPerHour) throw new Error("这个小时的提问已经用完");
  if (!project.github_url.trim()) {
    return toPublicAsk(
      insertRun({
        projectId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        threadId,
        question,
        status: "failed",
        error: NO_REPO,
      })
    );
  }
  const dispatch = getDb()
    .prepare("SELECT webhook_url, webhook_secret FROM project_dispatch WHERE project_id = ?")
    .get(projectId) as { webhook_url: string; webhook_secret: string } | undefined;
  if (!dispatch?.webhook_url || !dispatch.webhook_secret) {
    return toPublicAsk(
      insertRun({
        projectId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        threadId,
        question,
        status: "failed",
        error: OFFLINE,
      })
    );
  }
  const previous = getDb()
    .prepare(
      `SELECT session_id FROM ask_runs
       WHERE project_id = ? AND thread_id = ? AND actor_type = ? AND actor_id = ? AND session_id != ''
       ORDER BY id DESC LIMIT 1`
    )
    .get(projectId, threadId, actor.actorType, actor.actorId) as { session_id: string } | undefined;
  const row = insertRun({
    projectId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    threadId,
    question,
    status: "streaming",
    force: input.force,
    sessionId: "",
  });
  const prompt = buildAskPrompt({
    projectName: project.name,
    code: project.code,
    branch: project.default_branch,
    techStack: project.tech_stack,
    notes: project.agent_notes,
    question,
    openBugs: openBugLines(projectId),
    documents: projectDocumentExcerpt(projectId),
    featureMap: featureMapExcerpt(projectId),
    draft: input.draft,
  });
  const taken = takeAskImages([
    ...attachmentBuffers(projectId, input.attachmentIds || []),
    ...(input.images || []),
  ]);
  const names = taken.kept.length ? saveAskImageFiles(row.id, taken.kept) : [];
  const origin = new URL(callbackUrl).origin;
  const payload = {
    event: "project.ask",
    runId: row.id,
    callbackUrl,
    sessionId: input.force ? "" : previous?.session_id || "",
    prompt,
    images: names.map((name) => ({
      name,
      url: `${origin}/api/ask-images/${row.id}/${encodeURIComponent(name)}?t=${askImageToken(dispatch.webhook_secret, row.id, name)}`,
    })),
    imagesOmitted: taken.omitted,
    project: {
      id: project.id,
      code: project.code,
      name: project.name,
      githubUrl: project.github_url,
      defaultBranch: project.default_branch,
    },
  };
  const body = JSON.stringify(payload);
  getDb().prepare("UPDATE ask_runs SET payload = ?, status_line = ? WHERE id = ?").run(body, "已交给代码机", row.id);
  try {
    const res = await askFetch(dispatch.webhook_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bugboard-Signature": `sha256=${sign(dispatch.webhook_secret, body)}`,
      },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const text = await res.text();
      saveView(row.id, {
        ...emptyAskView(),
        status: "failed",
        error: wakeFailureText(text).slice(0, 300) || OFFLINE,
      });
    }
  } catch {
    getDb()
      .prepare(
        `UPDATE ask_runs
         SET queued = 1, status = 'streaming', status_line = ?, error = '', updated_at = ?
         WHERE id = ?`
      )
      .run("代码机暂时不在，已留下，上线后继续", nowIso(), row.id);
  }
  const saved = getRun(row.id);
  if (!saved) throw new Error("这次提问不存在");
  return toPublicAsk(saved);
}

function featureMapExcerpt(projectId: number) {
  const row = getDb().prepare("SELECT body FROM ask_maps WHERE project_id = ?").get(projectId) as
    | { body: string }
    | undefined;
  return row?.body || "";
}

function openBugLines(projectId: number) {
  return getDb()
    .prepare(
      `SELECT public_id AS publicId, title FROM bugs
       WHERE project_id = ? AND status NOT IN ('confirmed', 'acknowledged')
       ORDER BY updated_at DESC LIMIT 20`
    )
    .all(projectId) as { publicId: string; title: string }[];
}

function projectDocumentExcerpt(projectId: number) {
  const rows = getDb()
    .prepare("SELECT filename, mime, storage_path FROM project_documents WHERE project_id = ? ORDER BY id")
    .all(projectId) as { filename: string; mime: string; storage_path: string }[];
  const files = rows.flatMap((row) => {
    if (!/\.(md|txt)$/i.test(row.filename) && !row.mime.startsWith("text/")) return [];
    try {
      const text = fs.readFileSync(absoluteAttachmentPath(row.storage_path), "utf8");
      return [{ filename: row.filename, text }];
    } catch {
      return [];
    }
  });
  return documentExcerpt(files);
}

export function claimQueuedAsks() {
  const rows = getDb()
    .prepare(
      `SELECT id, payload FROM ask_runs
       WHERE queued = 1 AND status = 'streaming' AND payload != ''
       ORDER BY id LIMIT 5`
    )
    .all() as { id: number; payload: string }[];
  const jobs: unknown[] = [];
  for (const row of rows) {
    getDb().prepare("UPDATE ask_runs SET queued = 0, updated_at = ? WHERE id = ?").run(nowIso(), row.id);
    try {
      jobs.push(JSON.parse(row.payload));
    } catch {
      // 损坏的任务不再重试
    }
  }
  return jobs;
}

export async function startFeatureMap(identity: Identity, projectId: number, callbackUrl: string) {
  return startAsk(
    identity,
    projectId,
    {
      question: ASK_MAP_QUESTION,
      threadId: `map${String(projectId).padStart(12, "0")}`.slice(0, 20),
      force: true,
    },
    callbackUrl
  );
}

export function readFeatureMap(identity: Identity, projectId: number) {
  if (!canAccessProject(identity, projectId)) throw new Error("无权访问该项目");
  const row = getDb()
    .prepare("SELECT body, updated_at FROM ask_maps WHERE project_id = ?")
    .get(projectId) as { body: string; updated_at: string } | undefined;
  if (!row?.body) return null;
  return { body: row.body, updatedAt: row.updated_at };
}

export function listAskGaps(identity: Identity, projectId: number) {
  if (!canAccessProject(identity, projectId)) throw new Error("无权访问该项目");
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return getDb()
    .prepare(
      `SELECT question, COUNT(*) AS count FROM ask_runs
       WHERE project_id = ? AND status = 'done' AND judgment = 'file' AND created_at >= ?
       GROUP BY question_norm
       ORDER BY count DESC, MAX(id) DESC
       LIMIT 8`
    )
    .all(projectId, since) as { question: string; count: number }[];
}
