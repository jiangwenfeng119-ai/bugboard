import { getDb, nowIso } from "./db";
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
  }
) {
  const project = assertProjectChangeAdmin(identity, projectId);
  if (!TRIGGERS.has(input.trigger)) throw new Error("发布触发方式无效");
  const result: ReleaseResult = input.result ?? "success";
  if (result !== "success" && result !== "failed") throw new Error("发布结果无效");

  const explicit = input.bugIds !== undefined;
  const bugIds = explicit
    ? explicitBugIds(projectId, input.bugIds ?? [], result)
    : listReadyToReleaseIds(projectId);
  const headSha = input.headSha?.trim() || "";
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
    return { release: insertChange(identity, projectId, releaseInput), bugIds };
  }

  const release = getDb().transaction(() => {
    const row = insertChange(identity, projectId, releaseInput);
    for (const id of bugIds) {
      transitionBug(identity, id, "release_fixes", "已随发布进入待确认");
    }
    linkChangesToRelease(projectId, bugIds, row.id, !explicit);
    return row;
  })();
  return { release, bugIds };
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

/** 先入队，不跑 git 或部署。后续 runner 读取这条 agent_dispatches。 */
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
  const info = getDb()
    .prepare(
      `INSERT INTO agent_dispatches
         (project_id, bug_id, reason, target, status, detail, created_at)
       VALUES (?, NULL, 'release', 'webhook', 'pending', ?, ?)`
    )
    .run(projectId, JSON.stringify(payload), nowIso());
  return { queued: true as const, dispatchId: Number(info.lastInsertRowid) };
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
