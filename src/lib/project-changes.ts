import { actorFromIdentity } from "./auth";
import { getDb, nowIso } from "./db";
import { canAccessProject, isProjectAdmin } from "./permissions";
import type {
  ActorType,
  Identity,
  ProjectChangeKind,
  ProjectChangeRow,
  ReleaseResult,
  ReleaseTrigger,
} from "./types";

export type { ProjectChangeKind, ProjectChangeRow, ReleaseResult, ReleaseTrigger };

const CODE_KINDS = new Set<ProjectChangeKind>(["fix", "feature", "chore"]);
const ALL_KINDS = new Set<ProjectChangeKind>(["fix", "feature", "chore", "release"]);

type StoredChange = Omit<ProjectChangeRow, "commit_shas" | "bug_ids"> & {
  commit_shas: string;
  bug_ids: string | null;
};

type ChangeInsert = {
  kind: ProjectChangeKind;
  title: string;
  summary?: string | null;
  commitShas: string[];
  branch?: string | null;
  bugIds?: number[];
  trigger?: ReleaseTrigger | null;
  result?: ReleaseResult | null;
  detail?: string | null;
};

export function recordChange(
  identity: Identity,
  projectId: number,
  input: {
    kind: Exclude<ProjectChangeKind, "release">;
    title: string;
    summary?: string;
    commitShas: string[];
    branch?: string;
    bugIds?: number[];
  }
) {
  const project = assertProjectChangeAdmin(identity, projectId);
  if (!CODE_KINDS.has(input.kind)) throw new Error("变更类型无效");
  const title = input.title?.trim() ?? "";
  if (!title) throw new Error("请填写变更标题");
  const summary = input.summary?.trim() || null;
  const change = insertChange(identity, projectId, {
    kind: input.kind,
    title,
    summary,
    commitShas: cleanShas(input.commitShas, true),
    branch: branchOrDefault(input.branch, project.default_branch),
    bugIds: cleanBugIds(projectId, input.bugIds),
  });
  return { change };
}

export function listChanges(
  identity: Identity,
  projectId: number,
  opts?: {
    kind?: ProjectChangeKind | "code";
    limit?: number;
    offset?: number;
    unreleased?: boolean;
  }
) {
  assertProjectVisible(identity, projectId);
  const where = ["project_id = ?"];
  const params: Array<number | string> = [projectId];
  if (opts?.unreleased) where.push("release_change_id IS NULL");
  if (opts?.kind === "code") {
    where.push("kind IN ('fix','feature','chore')");
  } else if (opts?.kind) {
    if (!ALL_KINDS.has(opts.kind)) throw new Error("变更类型无效");
    where.push("kind = ?");
    params.push(opts.kind);
  }
  const clause = where.join(" AND ");
  const total = (
    getDb()
      .prepare(`SELECT COUNT(*) AS c FROM project_changes WHERE ${clause}`)
      .get(...params) as { c: number }
  ).c;
  const rows = getDb()
    .prepare(
      `SELECT * FROM project_changes
       WHERE ${clause}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, clampLimit(opts?.limit), clampOffset(opts?.offset)) as StoredChange[];
  return { changes: rows.map(mapRow), total };
}

export function insertChange(identity: Identity, projectId: number, input: ChangeInsert) {
  const actor = actorFromIdentity(identity);
  const info = getDb()
    .prepare(
      `INSERT INTO project_changes (
         project_id, kind, title, summary, commit_shas, branch, bug_ids,
         release_change_id, trigger, result, detail, actor_type, actor_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      projectId,
      input.kind,
      input.title,
      input.summary?.trim() || null,
      JSON.stringify(input.commitShas),
      input.branch?.trim() || null,
      JSON.stringify(input.bugIds ?? []),
      input.trigger ?? null,
      input.result ?? null,
      input.detail?.trim() || null,
      actor.actorType,
      actor.actorId,
      nowIso()
    );
  return getChange(Number(info.lastInsertRowid));
}

/** 把尚未挂上发布的代码变更指向这次 release。无 bug 的变更只在整批发布时挂上。 */
export function linkChangesToRelease(
  projectId: number,
  bugIds: number[],
  releaseId: number,
  includeUnassigned: boolean
) {
  const rows = getDb()
    .prepare(
      `SELECT id, bug_ids FROM project_changes
       WHERE project_id = ? AND kind != 'release' AND release_change_id IS NULL`
    )
    .all(projectId) as { id: number; bug_ids: string | null }[];
  const released = new Set(bugIds);
  const matched = rows.flatMap((row) => {
    const ids = parseIdList(row.bug_ids);
    if (ids.length === 0) return includeUnassigned ? [row.id] : [];
    return ids.every((id) => released.has(id)) ? [row.id] : [];
  });
  if (matched.length === 0) return;
  const placeholders = matched.map(() => "?").join(",");
  getDb()
    .prepare(
      `UPDATE project_changes SET release_change_id = ? WHERE id IN (${placeholders})`
    )
    .run(releaseId, ...matched);
}

export function assertProjectChangeAdmin(identity: Identity, projectId: number) {
  const project = assertProjectVisible(identity, projectId);
  if (!isProjectAdmin(identity, projectId)) throw new Error("需要管理员权限");
  return project;
}

function assertProjectVisible(identity: Identity, projectId: number) {
  if (!canAccessProject(identity, projectId)) throw new Error("无权访问该项目");
  const project = getDb()
    .prepare("SELECT id, default_branch FROM projects WHERE id = ?")
    .get(projectId) as { id: number; default_branch: string } | undefined;
  if (!project) throw new Error("项目不存在");
  return project;
}

function getChange(id: number) {
  const row = getDb()
    .prepare("SELECT * FROM project_changes WHERE id = ?")
    .get(id) as StoredChange | undefined;
  if (!row) throw new Error("变更不存在");
  return mapRow(row);
}

function mapRow(row: StoredChange): ProjectChangeRow {
  return {
    ...row,
    summary: row.summary,
    branch: row.branch,
    commit_shas: parseStringList(row.commit_shas),
    bug_ids: parseIdList(row.bug_ids),
    actor_type: row.actor_type as ActorType,
  };
}

function cleanShas(shas: string[], required: boolean) {
  if (!Array.isArray(shas)) throw new Error("请填写 commit SHA");
  const cleaned: string[] = [];
  for (const raw of shas) {
    if (typeof raw !== "string") continue;
    const sha = raw.trim();
    if (!sha || cleaned.includes(sha)) continue;
    cleaned.push(sha);
  }
  if (required && cleaned.length === 0) throw new Error("请填写 commit SHA");
  return cleaned;
}

function cleanBugIds(projectId: number, bugIds: number[] | undefined) {
  if (!bugIds || bugIds.length === 0) return [];
  const ids = [...new Set(bugIds.filter((id) => Number.isInteger(id) && id > 0))].sort(
    (a, b) => a - b
  );
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = getDb()
    .prepare(`SELECT id FROM bugs WHERE project_id = ? AND id IN (${placeholders})`)
    .all(projectId, ...ids) as { id: number }[];
  if (rows.length !== ids.length) throw new Error("报障不存在");
  return ids;
}

function branchOrDefault(explicit: string | undefined, projectBranch: string) {
  const trimmed = explicit?.trim();
  if (trimmed) return trimmed;
  const fallback = projectBranch.trim();
  return fallback || null;
}

function parseStringList(raw: string | null) {
  return parseJsonList(raw).filter((value): value is string => typeof value === "string" && value.length > 0);
}

function parseIdList(raw: string | null) {
  return parseJsonList(raw).filter((value): value is number => Number.isInteger(value));
}

function parseJsonList(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function clampLimit(limit: number | undefined) {
  if (limit === undefined || !Number.isFinite(limit)) return 50;
  return Math.min(100, Math.max(1, Math.floor(limit)));
}

function clampOffset(offset: number | undefined) {
  if (offset === undefined || !Number.isFinite(offset)) return 0;
  return Math.max(0, Math.floor(offset));
}
