import { createHmac, timingSafeEqual } from "crypto";
import { actorFromIdentity } from "./auth";
import { judgmentLabel, redactAskText, wakeFailureText, type AskJudgment } from "./ask-core";
import { getDb, nowIso } from "./db";
import { isAdminRole } from "./roles";
import { resolveActorLabel } from "./services";
import type { Identity } from "./types";

export const OPTIMIZE_PATHS = [
  ".cursor/skills/ask-before-report/SKILL.md",
  "src/lib/ask-core.ts",
  "scripts/ask-protocol.mjs",
] as const;

const DIFF_MAX = 180_000;
const PROMPT_BUDGET = 52_000;
const OPEN_STATUS = ["queued", "sent", "reverting"];
const COVERING_STATUS = ["queued", "sent", "done", "reverting"];

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

let optimizeFetch: FetchLike | null = null;

export function setOptimizeFetchForTests(next: FetchLike | null) {
  optimizeFetch = next;
}

export type AskAdminRecord = {
  id: number;
  projectId: number;
  projectName: string;
  actor: string;
  question: string;
  answer: string;
  judgment: AskJudgment | "";
  status: string;
  error: string;
  createdAt: string;
};

export type AskOptimizationRow = {
  id: number;
  askRunId: number;
  projectId: number;
  projectName: string;
  actor: string;
  question: string;
  status: string;
  detail: string;
  prompt: string;
  diff: string;
  commitSha: string;
  revertSha: string;
  createdAt: string;
  updatedAt: string;
};

function requireAccountAdmin(identity: Identity) {
  if (!isAdminRole(identity.role)) throw new Error("需要管理员权限");
}

function sign(secret: string, body: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function signaturesMatch(secret: string, body: string, header: string) {
  const got = Buffer.from(String(header || "").replace(/^sha256=/, ""));
  const expected = Buffer.from(sign(secret, body));
  return expected.length === got.length && timingSafeEqual(expected, got);
}

function judgmentOf(value: string): AskJudgment | "" {
  if (value === "exists" || value === "file" || value === "unsure") return value;
  return "";
}

export function buildOptimizePrompt(input: {
  id: number;
  projectName: string;
  question: string;
  answer: string;
}) {
  const question = input.question.trim().slice(0, 4000);
  const answer = input.answer.trim().slice(0, 8000);
  return [
    "你是 Bugboard 的处理 Agent。这次只优化问答 Agent 的回复逻辑。",
    `优化编号：${input.id}`,
    `来源项目：${input.projectName}`,
    "问：",
    question,
    "答：",
    answer,
    "要改的只有这三处：",
    ...OPTIMIZE_PATHS.map((file) => `- ${file}`),
    "规则：回答正文必须先说明这个能力现在实现了还是没有。实现了就写代码里现在怎么判断、谁能操作、界面上怎么用，判断为已经有了，不要写报障建议。没有实现就先写「现在没有。这是新功能。」再写报障建议。现有功能坏了就先写现在的做法，再写报障建议。不要用「这需要报障」开头。",
    "对照上面这条问答。如果它在说明现状之前就建议报障，就把规则改得更不容易再这样。",
    "改完跑和问答相关的测试。提交说明的第一行必须是：",
    `ask-optimize #${input.id}`,
    "不要改别的功能，不要读 wake.config.json 和 .env。",
  ].join("\n");
}

type RunRow = {
  id: number;
  project_id: number;
  project_name: string;
  actor_type: "user" | "api_key";
  actor_id: number;
  question: string;
  answer: string;
  judgment: string;
  status: string;
  error: string;
  created_at: string;
};

function mapRecord(row: RunRow): AskAdminRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    actor: resolveActorLabel(row.actor_type, row.actor_id),
    question: row.question,
    answer: row.answer,
    judgment: judgmentOf(row.judgment),
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
  };
}

export function listAskAdminRecords(identity: Identity) {
  requireAccountAdmin(identity);
  const rows = getDb()
    .prepare(
      `SELECT r.id, r.project_id, p.name AS project_name, r.actor_type, r.actor_id,
              r.question, r.answer, r.judgment, r.status, r.error, r.created_at
       FROM ask_runs r
       JOIN projects p ON p.id = r.project_id
       ORDER BY r.id DESC
       LIMIT 200`
    )
    .all() as RunRow[];
  return rows.map(mapRecord);
}

export function readAskAdminRecord(identity: Identity, runId: number) {
  requireAccountAdmin(identity);
  const row = getDb()
    .prepare(
      `SELECT r.id, r.project_id, p.name AS project_name, r.actor_type, r.actor_id,
              r.question, r.answer, r.judgment, r.status, r.error, r.created_at
       FROM ask_runs r
       JOIN projects p ON p.id = r.project_id
       WHERE r.id = ?`
    )
    .get(runId) as RunRow | undefined;
  return row ? mapRecord(row) : null;
}

type OptRow = {
  id: number;
  ask_run_id: number;
  project_id: number;
  project_name: string;
  actor_type: "user" | "api_key";
  actor_id: number;
  question: string;
  status: string;
  detail: string;
  prompt: string;
  diff_text: string;
  commit_sha: string;
  revert_sha: string;
  created_at: string;
  updated_at: string;
};

function mapOpt(row: OptRow, withBody: boolean): AskOptimizationRow {
  return {
    id: row.id,
    askRunId: row.ask_run_id,
    projectId: row.project_id,
    projectName: row.project_name,
    actor: resolveActorLabel(row.actor_type, row.actor_id),
    question: row.question,
    status: row.status,
    detail: row.detail,
    prompt: withBody ? row.prompt : "",
    diff: withBody ? row.diff_text : "",
    commitSha: row.commit_sha,
    revertSha: row.revert_sha,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const OPT_SQL = `SELECT o.id, o.ask_run_id, o.project_id, p.name AS project_name,
       o.actor_type, o.actor_id, o.question, o.status, o.detail, o.prompt,
       o.diff_text, o.commit_sha, o.revert_sha, o.created_at, o.updated_at
     FROM ask_optimizations o
     JOIN projects p ON p.id = o.project_id`;

export function listAskOptimizations(identity: Identity) {
  requireAccountAdmin(identity);
  const rows = getDb()
    .prepare(
      `SELECT o.id, o.ask_run_id, o.project_id, p.name AS project_name,
              o.actor_type, o.actor_id, o.question, o.status, o.detail, '' AS prompt,
              '' AS diff_text, o.commit_sha, o.revert_sha, o.created_at, o.updated_at
       FROM ask_optimizations o
       JOIN projects p ON p.id = o.project_id
       ORDER BY o.id DESC
       LIMIT 100`
    )
    .all() as OptRow[];
  return rows.map((row) => mapOpt(row, false));
}

export function readAskOptimization(identity: Identity, id: number) {
  requireAccountAdmin(identity);
  const row = getDb().prepare(`${OPT_SQL} WHERE o.id = ?`).get(id) as OptRow | undefined;
  return row ? mapOpt(row, true) : null;
}

function dispatchFor(projectId: number) {
  return getDb()
    .prepare("SELECT webhook_url, webhook_secret FROM project_dispatch WHERE project_id = ?")
    .get(projectId) as { webhook_url: string; webhook_secret: string } | undefined;
}

async function postWake(url: string, secret: string, payload: unknown) {
  const body = JSON.stringify(payload);
  const send = optimizeFetch || fetch;
  const res = await send(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bugboard-Signature": `sha256=${sign(secret, body)}`,
    },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(wakeFailureText(text).slice(0, 300) || "代码机没有接住这次优化");
  return text;
}

function markOpt(id: number, status: string, detail: string) {
  getDb()
    .prepare("UPDATE ask_optimizations SET status = ?, detail = ?, updated_at = ? WHERE id = ?")
    .run(status, detail.slice(0, 500), nowIso(), id);
}

function linkRuns(optimizationId: number, runIds: number[]) {
  const insert = getDb().prepare(
    "INSERT OR IGNORE INTO ask_optimization_runs (optimization_id, ask_run_id) VALUES (?, ?)"
  );
  for (const runId of runIds) insert.run(optimizationId, runId);
}

function openOptimization() {
  return getDb()
    .prepare(
      `SELECT id FROM ask_optimizations
       WHERE status IN (${OPEN_STATUS.map(() => "?").join(",")})
       LIMIT 1`
    )
    .get(...OPEN_STATUS) as { id: number } | undefined;
}

function runIsOpen(runId: number) {
  return getDb()
    .prepare(
      `SELECT o.id FROM ask_optimizations o
       JOIN ask_optimization_runs j ON j.optimization_id = o.id
       WHERE j.ask_run_id = ? AND o.status IN (${OPEN_STATUS.map(() => "?").join(",")})
       LIMIT 1`
    )
    .get(runId, ...OPEN_STATUS) as { id: number } | undefined;
}

const ELIGIBLE_SQL = `SELECT r.id, r.project_id, p.name AS project_name, r.actor_type, r.actor_id,
       r.question, r.answer, r.judgment, r.status, r.error, r.created_at
     FROM ask_runs r
     JOIN projects p ON p.id = r.project_id
     WHERE r.status = 'done'
     AND NOT EXISTS (
       SELECT 1 FROM ask_optimization_runs j
       JOIN ask_optimizations o ON o.id = j.optimization_id
       WHERE j.ask_run_id = r.id
         AND o.status IN (${COVERING_STATUS.map(() => "?").join(",")})
     )
     ORDER BY r.id DESC`;

function eligibleRuns() {
  return (getDb().prepare(ELIGIBLE_SQL).all(...COVERING_STATUS) as RunRow[]).map(mapRecord);
}

export function askOptimizeQueue(identity: Identity) {
  requireAccountAdmin(identity);
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM ask_runs r
       WHERE r.status = 'done'
       AND NOT EXISTS (
         SELECT 1 FROM ask_optimization_runs j
         JOIN ask_optimizations o ON o.id = j.optimization_id
         WHERE j.ask_run_id = r.id
           AND o.status IN (${COVERING_STATUS.map(() => "?").join(",")})
       )`
    )
    .get(...COVERING_STATUS) as { n: number };
  return { ready: Number(row.n), busy: Boolean(openOptimization()) };
}

function wakeDispatch(preferredProjectId: number) {
  const rows = getDb()
    .prepare(
      `SELECT p.id, p.name, p.slug, p.code, d.webhook_url, d.webhook_secret
       FROM project_dispatch d
       JOIN projects p ON p.id = d.project_id
       WHERE TRIM(d.webhook_url) != '' AND TRIM(d.webhook_secret) != ''
       ORDER BY p.id`
    )
    .all() as {
    id: number;
    name: string;
    slug: string;
    code: string;
    webhook_url: string;
    webhook_secret: string;
  }[];
  const own = rows.find((row) => /bugboard/i.test(`${row.slug} ${row.code} ${row.name}`));
  if (own) return own;
  return rows.find((row) => row.id === preferredProjectId) || rows[0] || null;
}

export function buildBatchOptimizePrompt(input: {
  id: number;
  items: { projectName: string; question: string; answer: string; judgment: string }[];
}) {
  const body = input.items
    .map((item, index) => {
      const question = item.question.trim().slice(0, 1500);
      const answer = item.answer.trim().slice(0, 2500);
      return [
        `${index + 1}. 项目：${item.projectName}`,
        `判断：${judgmentLabel(item.judgment) || "没有判断"}`,
        "问：",
        question,
        "答：",
        answer,
      ].join("\n");
    })
    .join("\n\n");
  return [
    "你是 Bugboard 的处理 Agent。这次一次看完下面还没优化过的问答，只优化问答 Agent 的回复逻辑。",
    `优化编号：${input.id}`,
    `共 ${input.items.length} 条。逐条检查要不要改规则，以及怎么改。不需要改的，不要为了它动代码。`,
    "要改的只有这三处：",
    ...OPTIMIZE_PATHS.map((file) => `- ${file}`),
    "规则：回答正文必须先说明这个能力现在实现了还是没有。实现了就写代码里现在怎么判断、谁能操作、界面上怎么用，判断为已经有了，不要写报障建议。没有实现就先写「现在没有。这是新功能。」再写报障建议。现有功能坏了就先写现在的做法，再写报障建议。不要用「这需要报障」开头。",
    "如果这些问答都已经先说明现状，就不要改文件，也不要提交。",
    "如果要改，改完跑和问答相关的测试。提交说明的第一行必须是：",
    `ask-optimize #${input.id}`,
    "不要改别的功能，不要读 wake.config.json 和 .env。",
    "",
    body,
  ].join("\n");
}

function promptItems(runs: AskAdminRecord[]) {
  return runs.map((run) => ({
    projectName: run.projectName,
    question: run.question,
    answer: run.answer,
    judgment: run.judgment,
  }));
}

function packRuns(runs: AskAdminRecord[]) {
  const chosen = runs.slice();
  const fits = (items: AskAdminRecord[]) =>
    buildBatchOptimizePrompt({ id: 0, items: promptItems(items) }).length <= PROMPT_BUDGET;
  while (chosen.length > 1 && !fits(chosen)) chosen.pop();
  if (chosen[0] && !fits(chosen)) {
    const run = chosen[0];
    let answer = run.answer.trim().slice(0, 2500);
    let clipped = { ...run, answer };
    while (answer.length > 200 && !fits([clipped])) {
      answer = answer.slice(0, Math.floor(answer.length * 0.6));
      clipped = { ...run, answer };
    }
    chosen[0] = clipped;
  }
  return { chosen, omitted: runs.length - chosen.length };
}

async function wakeOptimization(
  identity: Identity,
  id: number,
  dispatch: { webhook_url: string; webhook_secret: string },
  project: { id: number; name: string },
  prompt: string,
  callbackUrl: string,
  sentDetail: string
) {
  try {
    await postWake(dispatch.webhook_url, dispatch.webhook_secret, {
      event: "ask.needs_optimize",
      optimizationId: id,
      callbackUrl,
      prompt,
      commitSha: "",
      diff: "",
      project,
    });
    markOpt(id, "sent", sentDetail);
  } catch (error) {
    const message = error instanceof Error ? error.message : "代码机没有接住这次优化";
    markOpt(id, "failed", message);
  }
  const saved = readAskOptimization(identity, id);
  if (!saved) throw new Error("这次优化不存在");
  return saved;
}

export async function submitAskOptimization(identity: Identity, runId: number, callbackUrl: string) {
  requireAccountAdmin(identity);
  const run = readAskAdminRecord(identity, runId);
  if (!run) throw new Error("这次提问不存在");
  if (run.status !== "done") throw new Error("这条问答还没答完，不能拿去优化");
  const dispatch = dispatchFor(run.projectId);
  if (!dispatch?.webhook_url || !dispatch.webhook_secret) throw new Error("这个项目还没把叫醒地址配好");
  const actor = actorFromIdentity(identity);
  const id = getDb().transaction(() => {
    if (runIsOpen(runId)) throw new Error("这条问答已有进行中的优化");
    if (openOptimization()) throw new Error("已有进行中的优化，等它结束再提交");
    const t = nowIso();
    const info = getDb()
      .prepare(
        `INSERT INTO ask_optimizations
           (ask_run_id, project_id, actor_type, actor_id, question, answer, judgment, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`
      )
      .run(runId, run.projectId, actor.actorType, actor.actorId, run.question, run.answer, run.judgment, t, t);
    const nextId = Number(info.lastInsertRowid);
    const prompt = buildOptimizePrompt({
      id: nextId,
      projectName: run.projectName,
      question: run.question,
      answer: run.answer,
    });
    getDb().prepare("UPDATE ask_optimizations SET prompt = ? WHERE id = ?").run(prompt, nextId);
    linkRuns(nextId, [runId]);
    return nextId;
  })();
  const prompt = readAskOptimization(identity, id)?.prompt || "";
  return wakeOptimization(
    identity,
    id,
    dispatch,
    { id: run.projectId, name: run.projectName },
    prompt,
    callbackUrl,
    "已交给处理 Agent"
  );
}

export async function submitOpenAskOptimizations(identity: Identity, callbackUrl: string) {
  requireAccountAdmin(identity);
  const actor = actorFromIdentity(identity);
  const reserved = getDb().transaction(() => {
    if (openOptimization()) throw new Error("已有进行中的优化，等它结束再提交");
    const ready = eligibleRuns();
    if (ready.length === 0) throw new Error("没有还没提交的已答完问答");
    const dispatch = wakeDispatch(ready[0].projectId);
    if (!dispatch) throw new Error("还没把叫醒地址配好");
    const packed = packRuns(ready);
    const primary = packed.chosen[0];
    const t = nowIso();
    const label =
      packed.chosen.length === 1 ? primary.question : `共 ${packed.chosen.length} 条未优化问答`;
    const info = getDb()
      .prepare(
        `INSERT INTO ask_optimizations
           (ask_run_id, project_id, actor_type, actor_id, question, answer, judgment, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`
      )
      .run(
        primary.id,
        dispatch.id,
        actor.actorType,
        actor.actorId,
        label,
        packed.chosen.map((item) => item.answer).join("\n\n").slice(0, 8000),
        primary.judgment,
        t,
        t
      );
    const id = Number(info.lastInsertRowid);
    const prompt = buildBatchOptimizePrompt({ id, items: promptItems(packed.chosen) });
    getDb().prepare("UPDATE ask_optimizations SET prompt = ? WHERE id = ?").run(prompt, id);
    linkRuns(id, packed.chosen.map((item) => item.id));
    const detail =
      packed.omitted > 0
        ? `已交给处理 Agent，这次 ${packed.chosen.length} 条，还有 ${packed.omitted} 条下次再交`
        : `已交给处理 Agent，共 ${packed.chosen.length} 条`;
    return {
      id,
      prompt,
      detail,
      project: { id: dispatch.id, name: dispatch.name },
      dispatch: { webhook_url: dispatch.webhook_url, webhook_secret: dispatch.webhook_secret },
    };
  })();
  return wakeOptimization(
    identity,
    reserved.id,
    reserved.dispatch,
    reserved.project,
    reserved.prompt,
    callbackUrl,
    reserved.detail
  );
}

export async function requestOptimizeRevert(identity: Identity, id: number, callbackUrl: string) {
  requireAccountAdmin(identity);
  const current = readAskOptimization(identity, id);
  if (!current) throw new Error("这次优化不存在");
  if (current.status !== "done") throw new Error("只有已经记下改动的优化可以回滚");
  if (!current.commitSha && !current.diff.trim()) throw new Error("这次优化没有可回滚的改动");
  const dispatch = dispatchFor(current.projectId);
  if (!dispatch?.webhook_url || !dispatch.webhook_secret) throw new Error("这个项目还没把叫醒地址配好");
  markOpt(id, "reverting", "正在回滚");
  try {
    await postWake(dispatch.webhook_url, dispatch.webhook_secret, {
      event: "ask.optimize_revert",
      optimizationId: id,
      callbackUrl,
      prompt: "",
      commitSha: current.commitSha,
      diff: current.diff,
      project: { id: current.projectId, name: current.projectName },
    });
    markOpt(id, "reverting", "已交给代码机回滚");
  } catch (error) {
    const message = error instanceof Error ? error.message : "回滚没有送出";
    markOpt(id, "done", message);
  }
  const saved = readAskOptimization(identity, id);
  if (!saved) throw new Error("这次优化不存在");
  return saved;
}

export function acceptOptimizeCallback(raw: string, header: string) {
  let body: {
    optimizationId?: number;
    kind?: string;
    diff?: string;
    commitSha?: string;
    revertSha?: string;
    detail?: string;
  };
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error("不是 JSON");
  }
  const id = Number(body.optimizationId);
  const row = getDb()
    .prepare("SELECT id, project_id, status, diff_text, commit_sha FROM ask_optimizations WHERE id = ?")
    .get(id) as
    | { id: number; project_id: number; status: string; diff_text: string; commit_sha: string }
    | undefined;
  if (!row) throw new Error("这次优化不存在");
  const secret = (
    getDb().prepare("SELECT webhook_secret FROM project_dispatch WHERE project_id = ?").get(row.project_id) as
      | { webhook_secret: string }
      | undefined
  )?.webhook_secret;
  if (!secret || !signaturesMatch(secret, raw, header)) throw new Error("签名不对");
  const kind = body.kind;
  const detail = redactAskText(String(body.detail || "")).slice(0, 500);
  const diff = redactAskText(String(body.diff || "")).slice(0, DIFF_MAX);
  const commitSha = /^[0-9a-f]{7,40}$/.test(String(body.commitSha || "")) ? String(body.commitSha) : row.commit_sha;
  const revertSha = /^[0-9a-f]{7,40}$/.test(String(body.revertSha || "")) ? String(body.revertSha) : "";
  if (kind === "failed") {
    const status = row.status === "reverting" ? "done" : "failed";
    getDb()
      .prepare("UPDATE ask_optimizations SET status = ?, detail = ?, updated_at = ? WHERE id = ?")
      .run(status, detail || "处理没有完成", nowIso(), id);
    return { id, status };
  }
  if (kind === "done") {
    getDb()
      .prepare(
        `UPDATE ask_optimizations
         SET status = 'done', detail = ?, diff_text = ?, commit_sha = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(detail || "已记下改动", diff || row.diff_text, commitSha, nowIso(), id);
    return { id, status: "done" };
  }
  if (kind === "reverted") {
    getDb()
      .prepare(
        `UPDATE ask_optimizations
         SET status = 'reverted', detail = ?, revert_sha = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(detail || "已回滚", revertSha, nowIso(), id);
    return { id, status: "reverted" };
  }
  throw new Error("不认识的优化事件");
}
