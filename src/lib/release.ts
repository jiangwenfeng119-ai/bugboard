import { getDb, nowIso } from "./db";
import { pokeReleaseRunner, type DeployMode } from "./dispatch";
import { isProjectAdmin, requireAdmin } from "./permissions";
import {
  assertProjectChangeAdmin,
  insertChange,
  linkChangesToRelease,
  listChanges,
} from "./project-changes";
import { transitionBug } from "./services";
import type { Identity, ReleaseResult, ReleaseTrigger } from "./types";

export type { ReleaseResult, ReleaseTrigger };

const TRIGGERS = new Set<ReleaseTrigger>(["scheduled", "manual", "external"]);

/** A crashed runner leaves the claim running. After 45 minutes it is failed so the next nightly enqueue is not blocked. */
const RELEASE_RUNNING_TIMEOUT_MS = 45 * 60 * 1000;
const STALE_RELEASE = "发布任务超时未完成，已释放";

/** 不跑部署：写 release 行 + 批量 release_fixes + 挂 release_change_id。失败只记账，不改报障状态。 */
export function markReleased(
  identity: Identity,
  projectId: number,
  input: {
    trigger: ReleaseTrigger;
    headSha?: string;
    bugIds?: number[];
    detail?: string;
    result?: ReleaseResult;
    dispatchId?: number;
  }
) {
  const project = assertProjectChangeAdmin(identity, projectId);
  if (!TRIGGERS.has(input.trigger)) throw new Error("发布触发方式无效");
  const result: ReleaseResult = input.result ?? "success";
  if (result !== "success" && result !== "failed") throw new Error("发布结果无效");

  const fromRunner = input.dispatchId !== undefined;
  const explicit = input.bugIds !== undefined;
  const bugIds =
    !explicit
      ? listReadyToReleaseIds(projectId)
      : fromRunner && result === "success"
        ? readySubset(projectId, input.bugIds ?? [])
        : explicitBugIds(projectId, input.bugIds ?? [], result);
  const headSha = typeof input.headSha === "string" ? input.headSha.trim() : "";
  const short = headSha.slice(0, 7);
  const releaseInput = {
    kind: "release" as const,
    title: short ? `发布 ${short}` : "发布",
    commitShas: headSha ? [headSha] : [],
    branch: project.default_branch.trim() || null,
    bugIds,
    trigger: input.trigger,
    result,
    detail: input.detail?.trim() || null,
  };

  if (result === "failed") {
    const release = getDb().transaction(() => {
      const row = insertChange(identity, projectId, releaseInput);
      closeRunningRelease(projectId, input.dispatchId, "failed", input.detail?.trim() || "发布失败");
      return row;
    })();
    return { release, bugIds };
  }

  const done = getDb().transaction(() => {
    const advancing = fromRunner
      ? explicit
        ? readySubset(projectId, input.bugIds ?? [])
        : listReadyToReleaseIds(projectId)
      : bugIds;
    const row = insertChange(identity, projectId, { ...releaseInput, bugIds: advancing });
    for (const id of advancing) {
      transitionBug(identity, id, "release_fixes", "已随发布进入待确认");
    }
    linkChangesToRelease(projectId, advancing, row.id, !explicit);
    closeRunningRelease(projectId, input.dispatchId, "sent", short ? `已发布 ${short}` : "已发布");
    return { release: row, bugIds: advancing };
  })();
  return done;
}

/** 待发布报障，以及还没挂上某次发布的代码变更。仅管理员。 */
export function listPendingRelease(identity: Identity, projectId: number) {
  assertProjectChangeAdmin(identity, projectId);
  const bugs = getDb()
    .prepare(
      `SELECT id, public_id, title, priority
       FROM bugs
       WHERE project_id = ? AND status = 'ready_to_release'
       ORDER BY id`
    )
    .all(projectId) as { id: number; public_id: string; title: string; priority: string }[];
  const { changes } = listChanges(identity, projectId, {
    kind: "code",
    unreleased: true,
    limit: 100,
  });
  return {
    bugs,
    changes: changes.map((change) => ({
      id: change.id,
      kind: change.kind,
      title: change.title,
      commit_shas: change.commit_shas,
      bug_ids: change.bug_ids,
      created_at: change.created_at,
    })),
  };
}

/** 入队等待本机发布任务，不跑 git 或部署。发布 runner 读取这条 agent_dispatches。 */
export function requestRunRelease(
  identity: Identity,
  projectId: number,
  input: {
    trigger: ReleaseTrigger;
    headSha?: string;
    bugIds?: number[];
    detail?: string;
  }
) {
  assertProjectChangeAdmin(identity, projectId);
  if (!TRIGGERS.has(input.trigger)) throw new Error("发布触发方式无效");
  const bugIds =
    input.bugIds === undefined ? null : explicitBugIds(projectId, input.bugIds, "success");
  const payload = {
    mode: "run",
    trigger: input.trigger,
    bugIds,
    headSha: input.headSha?.trim() || null,
    detail: input.detail?.trim() || null,
  };
  const dispatchId = getDb().transaction(() => {
    expireStaleRunningReleases();
    if (releaseInFlight(projectId)) throw new Error("已有发布任务在排队或执行");
    return insertQueuedRelease(projectId, payload);
  })();
  pokeReleaseRunner(projectId, dispatchId);
  return { queued: true as const, dispatchId };
}

export type ReleaseJob = {
  dispatchId: number;
  projectId: number;
  code: string;
  slug: string;
  githubUrl: string;
  defaultBranch: string;
  deployMode: DeployMode;
  deployCommand: string;
  trigger: ReleaseTrigger;
  bugIds: number[] | null;
  detail: string | null;
};

/** 把一条排队的发布领成执行中。project 可填缩写或 slug。 */
export function claimQueuedRelease(identity: Identity, projectKey?: string): ReleaseJob | null {
  if (!requireAdmin(identity)) throw new Error("需要管理员权限");
  const key = projectKey?.trim() || "";
  const folded = key.toLowerCase();
  return getDb().transaction(() => {
    expireStaleRunningReleases();
    const rows = getDb()
      .prepare(
        `SELECT d.id, d.project_id, d.detail,
                p.code, p.slug, p.github_url, p.default_branch,
                IFNULL(cfg.deploy_mode, 'none') AS deploy_mode,
                IFNULL(cfg.deploy_command, '') AS deploy_command
         FROM agent_dispatches d
         JOIN projects p ON p.id = d.project_id
         LEFT JOIN project_dispatch cfg ON cfg.project_id = d.project_id
         WHERE d.target = 'release_runner' AND d.reason = 'release' AND d.status = 'queued'
         ORDER BY d.id`
      )
      .all() as {
      id: number;
      project_id: number;
      detail: string;
      code: string;
      slug: string;
      github_url: string;
      default_branch: string;
      deploy_mode: string;
      deploy_command: string;
    }[];
    const row = rows.find((item) => {
      if (!isProjectAdmin(identity, item.project_id)) return false;
      if (!key) return true;
      return item.code === key || item.slug === key || item.code.toLowerCase() === folded;
    });
    if (!row) return null;
    const updated = getDb()
      .prepare(
        "UPDATE agent_dispatches SET status = 'running', claimed_at = ? WHERE id = ? AND status = 'queued'"
      )
      .run(nowIso(), row.id);
    if (updated.changes !== 1) return null;
    const payload = readReleasePayload(row.detail);
    const deployMode: DeployMode =
      row.deploy_mode === "restart" || row.deploy_mode === "ecs_deploy" ? row.deploy_mode : "none";
    return {
      dispatchId: row.id,
      projectId: row.project_id,
      code: row.code,
      slug: row.slug,
      githubUrl: row.github_url || "",
      defaultBranch: row.default_branch || "",
      deployMode,
      deployCommand: row.deploy_command || "",
      trigger: payload.trigger,
      bugIds: payload.bugIds,
      detail: payload.detail,
    };
  })();
}

/** 给 release_schedule 刚好是 at（HH:MM）且会自动部署的项目各入队一条。 */
export function enqueueScheduledReleases(identity: Identity, at: string) {
  if (!requireAdmin(identity)) throw new Error("需要管理员权限");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(at)) throw new Error("定时无效");
  const rows = getDb()
    .prepare(
      `SELECT p.id, p.code
       FROM project_dispatch d
       JOIN projects p ON p.id = d.project_id
       WHERE d.release_schedule = ? AND d.deploy_mode IN ('restart', 'ecs_deploy')
       ORDER BY p.id`
    )
    .all(at) as { id: number; code: string }[];
  const created: { projectId: number; dispatchId: number; code: string }[] = [];
  getDb().transaction(() => {
    expireStaleRunningReleases();
    for (const row of rows) {
      if (!isProjectAdmin(identity, row.id)) continue;
      if (releaseInFlight(row.id)) continue;
      const dispatchId = insertQueuedRelease(row.id, {
        mode: "run",
        trigger: "scheduled",
        bugIds: null,
        headSha: null,
        detail: null,
      });
      created.push({ projectId: row.id, dispatchId, code: row.code });
    }
  })();
  return created;
}

/** 发布任务跑完后记账。成功只推进仍待发布的报障；失败只留失败记录。记账抛错时改记失败并结束任务。 */
export function finishRunningRelease(
  identity: Identity,
  input: {
    dispatchId: number;
    result: ReleaseResult;
    headSha?: string;
    detail?: string;
  }
) {
  const row = getDb()
    .prepare(
      `SELECT project_id, detail, status, target, reason
       FROM agent_dispatches WHERE id = ?`
    )
    .get(input.dispatchId) as
    | { project_id: number; detail: string; status: string; target: string; reason: string }
    | undefined;
  if (!row || row.target !== "release_runner" || row.reason !== "release") {
    throw new Error("发布任务不存在");
  }
  if (row.status !== "running") throw new Error("发布任务不在执行中");
  const payload = readReleasePayload(row.detail);
  const bugIds = payload.bugIds === null ? undefined : payload.bugIds;
  try {
    return markReleased(identity, row.project_id, {
      trigger: payload.trigger,
      bugIds,
      headSha: input.headSha,
      detail: input.detail ?? payload.detail ?? undefined,
      result: input.result,
      dispatchId: input.dispatchId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "发布失败";
    abandonRunningRelease(identity, row.project_id, input.dispatchId, {
      trigger: payload.trigger,
      bugIds,
      headSha: typeof input.headSha === "string" ? input.headSha : undefined,
      detail: message,
    });
    throw error;
  }
}

function listReadyToReleaseIds(projectId: number) {
  return (
    getDb()
      .prepare(
        `SELECT id FROM bugs
         WHERE project_id = ? AND status = 'ready_to_release'
         ORDER BY id`
      )
      .all(projectId) as { id: number }[]
  ).map((row) => row.id);
}

function explicitBugIds(projectId: number, bugIds: number[], result: ReleaseResult) {
  const ids = [...new Set(bugIds.filter((id) => Number.isInteger(id) && id > 0))].sort(
    (a, b) => a - b
  );
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = getDb()
    .prepare(`SELECT id, project_id, status FROM bugs WHERE id IN (${placeholders})`)
    .all(...ids) as { id: number; project_id: number; status: string }[];
  if (rows.length !== ids.length || rows.some((row) => row.project_id !== projectId)) {
    throw new Error("报障不存在");
  }
  if (result === "success" && rows.some((row) => row.status !== "ready_to_release")) {
    throw new Error("只有待发布的报障可以随发布推进");
  }
  return ids;
}

function expireStaleRunningReleases(now = Date.now()) {
  const cutoff = new Date(now - RELEASE_RUNNING_TIMEOUT_MS).toISOString();
  getDb()
    .prepare(
      `UPDATE agent_dispatches
       SET status = 'failed', detail = ?
       WHERE target = 'release_runner' AND reason = 'release' AND status = 'running'
         AND COALESCE(NULLIF(claimed_at, ''), created_at) < ?`
    )
    .run(STALE_RELEASE, cutoff);
}

function readySubset(projectId: number, bugIds: number[]) {
  const ids = [...new Set(bugIds.filter((id) => Number.isInteger(id) && id > 0))].sort(
    (a, b) => a - b
  );
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT id FROM bugs
       WHERE project_id = ? AND status = 'ready_to_release' AND id IN (${placeholders})`
    )
    .all(projectId, ...ids) as { id: number }[];
  const ready = new Set(rows.map((row) => row.id));
  return ids.filter((id) => ready.has(id));
}

function releaseInFlight(projectId: number) {
  return getDb()
    .prepare(
      `SELECT id FROM agent_dispatches
       WHERE project_id = ? AND target = 'release_runner' AND reason = 'release'
         AND status IN ('queued', 'running')
       LIMIT 1`
    )
    .get(projectId) as { id: number } | undefined;
}

function abandonRunningRelease(
  identity: Identity,
  projectId: number,
  dispatchId: number,
  input: {
    trigger: ReleaseTrigger;
    bugIds?: number[];
    headSha?: string;
    detail: string;
  }
) {
  try {
    markReleased(identity, projectId, {
      trigger: input.trigger,
      bugIds: input.bugIds,
      headSha: input.headSha,
      detail: input.detail,
      result: "failed",
      dispatchId,
    });
    return;
  } catch {
    // The failure row could not be written. The claim still has to close.
  }
  try {
    closeRunningRelease(projectId, dispatchId, "failed", input.detail);
  } catch {
    // Already closed, or no longer running.
  }
}

function insertQueuedRelease(projectId: number, payload: unknown) {
  const info = getDb()
    .prepare(
      `INSERT INTO agent_dispatches
         (project_id, bug_id, reason, target, status, detail, created_at)
       VALUES (?, NULL, 'release', 'release_runner', 'queued', ?, ?)`
    )
    .run(projectId, JSON.stringify(payload), nowIso());
  return Number(info.lastInsertRowid);
}

function closeRunningRelease(
  projectId: number,
  dispatchId: number | undefined,
  status: "sent" | "failed",
  detail: string
) {
  if (!dispatchId) return;
  const info = getDb()
    .prepare(
      `UPDATE agent_dispatches
       SET status = ?, detail = ?
       WHERE id = ? AND project_id = ? AND target = 'release_runner'
         AND reason = 'release' AND status = 'running'`
    )
    .run(status, detail.trim().slice(0, 180), dispatchId, projectId);
  if (info.changes !== 1) throw new Error("发布任务不在执行中");
}

function readReleasePayload(detail: string): {
  trigger: ReleaseTrigger;
  bugIds: number[] | null;
  detail: string | null;
} {
  try {
    const data = JSON.parse(detail) as { trigger?: unknown; bugIds?: unknown; detail?: unknown };
    const trigger: ReleaseTrigger =
      data.trigger === "scheduled" || data.trigger === "manual" || data.trigger === "external"
        ? data.trigger
        : "manual";
    const bugIds = Array.isArray(data.bugIds)
      ? data.bugIds.filter((id): id is number => Number.isInteger(id) && id > 0)
      : null;
    return {
      trigger,
      bugIds,
      detail: typeof data.detail === "string" ? data.detail : null,
    };
  } catch {
    return { trigger: "manual", bugIds: null, detail: null };
  }
}
