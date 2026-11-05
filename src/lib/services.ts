import fs from "fs";
import { getDb, isSetupComplete, nowIso } from "./db";
import { recentShanghaiDateKeys, shanghaiDaySql, shanghaiDayStartIso } from "./time";
import {
  actorFromIdentity,
  generateApiKey,
  hashApiKey,
  hashPassword,
  verifyPassword,
} from "./auth";
import { canAccessProject, listAccessibleProjectIds, requireAdmin } from "./permissions";
import {
  ACTION_LABEL,
  allowedActions,
  validateTransition,
  type TransitionAction,
} from "./state-machine";
import type {
  AnalyticsRange,
  ApiKeyRow,
  AttachmentRow,
  BugRow,
  BugStatus,
  Identity,
  Priority,
  ProjectRow,
  ReporterAnalytics,
  ReporterPresence,
  ReporterProjectStat,
  ReporterStat,
  Role,
  StatusCounts,
  StatusEventRow,
  UserRow,
} from "./types";
import { STATUS_LABEL } from "./types";
import { allocateProjectCode, assertUsableCode, nextPublicId } from "./ticket-id";
import { absoluteAttachmentPath } from "./uploads";

function slugify(name: string) {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `project-${Date.now()}`;
}

export async function setupAdmin(username: string, password: string) {
  if (isSetupComplete()) throw new Error("系统已完成首装");
  if (!username.trim() || password.length < 6) {
    throw new Error("用户名必填，密码至少 6 位");
  }
  const hash = await hashPassword(password);
  const t = nowIso();
  const info = getDb()
    .prepare(
      `INSERT INTO users (username, password_hash, role, active, created_at, updated_at)
       VALUES (?, ?, 'superadmin', 1, ?, ?)`
    )
    .run(username.trim(), hash, t, t);
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid) as UserRow;
}

export async function login(username: string, password: string) {
  const user = getDb()
    .prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE")
    .get(username.trim()) as UserRow | undefined;
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    throw new Error("账号或密码错误");
  }
  if (!user.active) throw new Error("账号已禁用");
  return user;
}

export async function changeOwnPassword(
  identity: Identity,
  data: { currentPassword: string; newPassword: string }
) {
  if (identity.kind !== "user") throw new Error("无权修改密码");
  const user = getUserOrThrow(identity.userId);
  if (!user.active) throw new Error("账号已禁用");
  const currentPassword = data.currentPassword ?? "";
  const newPassword = data.newPassword ?? "";
  if (!(await verifyPassword(currentPassword, user.password_hash))) {
    throw new Error("当前密码不正确");
  }
  if (newPassword.length < 6) throw new Error("新密码至少 6 位");
  if (newPassword === currentPassword) throw new Error("新密码不能与当前密码相同");
  const hash = await hashPassword(newPassword);
  getDb()
    .prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
    .run(hash, nowIso(), user.id);
}

export function listProjects(identity: Identity): ProjectRow[] {
  const ids = listAccessibleProjectIds(identity);
  if (ids === "all") {
    return getDb()
      .prepare("SELECT * FROM projects ORDER BY updated_at DESC")
      .all() as ProjectRow[];
  }
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  return getDb()
    .prepare(
      `SELECT * FROM projects WHERE id IN (${placeholders}) ORDER BY updated_at DESC`
    )
    .all(...ids) as ProjectRow[];
}

function takenProjectCodes(exceptId?: number) {
  const rows = getDb()
    .prepare("SELECT id, code FROM projects WHERE code IS NOT NULL AND code != ''")
    .all() as { id: number; code: string }[];
  return rows.flatMap((row) => (row.id === exceptId ? [] : [row.code]));
}

export function createProject(
  identity: Identity,
  data: { name: string; description?: string; slug?: string; code?: string }
) {
  if (!requireAdmin(identity)) throw new Error("需要管理员权限");
  const name = data.name.trim();
  if (!name) throw new Error("项目名称必填");
  let slug = (data.slug || slugify(name)).trim();
  const exists = getDb()
    .prepare("SELECT id FROM projects WHERE slug = ?")
    .get(slug);
  if (exists) slug = `${slug}-${Date.now().toString(36)}`;
  const code = data.code?.trim()
    ? assertUsableCode(data.code, takenProjectCodes())
    : allocateProjectCode(name, slug, takenProjectCodes());
  const t = nowIso();
  const info = getDb()
    .prepare(
      `INSERT INTO projects (name, slug, code, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(name, slug, code, data.description?.trim() || "", t, t);
  return getDb()
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(info.lastInsertRowid) as ProjectRow;
}

export function deleteProject(identity: Identity, projectId: number) {
  if (identity.role !== "superadmin") throw new Error("无权删除项目");
  const project = getDb()
    .prepare("SELECT id FROM projects WHERE id = ?")
    .get(projectId);
  if (!project) throw new Error("项目不存在");

  const db = getDb();
  const paths = db.transaction(() => {
    const files = db
      .prepare(
        `SELECT storage_path FROM attachments
         WHERE (owner_type = 'bug' AND owner_id IN (SELECT id FROM bugs WHERE project_id = ?))
            OR (owner_type = 'status_event' AND owner_id IN (
              SELECT e.id FROM bug_status_events e
              JOIN bugs b ON b.id = e.bug_id
              WHERE b.project_id = ?
            ))`
      )
      .all(projectId, projectId) as { storage_path: string }[];
    db.prepare(
      `DELETE FROM attachments
       WHERE (owner_type = 'bug' AND owner_id IN (SELECT id FROM bugs WHERE project_id = ?))
          OR (owner_type = 'status_event' AND owner_id IN (
            SELECT e.id FROM bug_status_events e
            JOIN bugs b ON b.id = e.bug_id
            WHERE b.project_id = ?
          ))`
    ).run(projectId, projectId);
    db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
    return files.map((f) => f.storage_path);
  })();

  for (const rel of paths) {
    try {
      fs.unlinkSync(absoluteAttachmentPath(rel));
    } catch {
      // 文件已不在磁盘上时，库记录仍然删除
    }
  }
}

export function getProject(identity: Identity, projectId: number) {
  if (!canAccessProject(identity, projectId)) throw new Error("无权访问该项目");
  const project = getDb()
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(projectId) as ProjectRow | undefined;
  if (!project) throw new Error("项目不存在");
  return project;
}

export function updateProject(
  identity: Identity,
  projectId: number,
  data: { name: string; description?: string; code?: string }
) {
  if (!requireAdmin(identity)) throw new Error("需要管理员权限");
  const existing = getProject(identity, projectId);
  const name = data.name.trim();
  if (!name) throw new Error("项目名称必填");
  const description = (data.description ?? existing.description).trim();
  const code =
    data.code === undefined
      ? existing.code
      : assertUsableCode(data.code, takenProjectCodes(projectId));
  getDb()
    .prepare(
      `UPDATE projects SET name = ?, code = ?, description = ?, updated_at = ? WHERE id = ?`
    )
    .run(name, code, description, nowIso(), projectId);
  return getProject(identity, projectId);
}

export function listMembers(identity: Identity, projectId: number) {
  getProject(identity, projectId);
  if (!requireAdmin(identity)) throw new Error("需要管理员权限");
  return getDb()
    .prepare(
      `SELECT u.id, u.username, u.role, u.active
       FROM project_members pm JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = ?
       ORDER BY u.username`
    )
    .all(projectId) as {
    id: number;
    username: string;
    role: Role;
    active: number;
  }[];
}

export function addMember(
  identity: Identity,
  projectId: number,
  userId: number
) {
  getProject(identity, projectId);
  if (!requireAdmin(identity)) throw new Error("需要管理员权限");
  const user = getDb().prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!user) throw new Error("用户不存在");
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)"
    )
    .run(projectId, userId);
  getDb()
    .prepare("UPDATE projects SET updated_at = ? WHERE id = ?")
    .run(nowIso(), projectId);
}

export function removeMember(
  identity: Identity,
  projectId: number,
  userId: number
) {
  getProject(identity, projectId);
  if (!requireAdmin(identity)) throw new Error("需要管理员权限");
  getDb()
    .prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?")
    .run(projectId, userId);
}

export function listUsers(identity: Identity) {
  if (!requireAdmin(identity)) throw new Error("需要管理员权限");
  return getDb()
    .prepare(
      "SELECT id, username, role, active, created_at, updated_at FROM users ORDER BY id"
    )
    .all() as Omit<UserRow, "password_hash">[];
}

export async function createUser(
  identity: Identity,
  data: { username: string; password: string; role: Role }
) {
  if (!requireAdmin(identity)) throw new Error("需要管理员权限");
  assertAssignableRole(identity, data.role);
  if (!data.username.trim() || data.password.length < 6) {
    throw new Error("用户名必填，密码至少 6 位");
  }
  const hash = await hashPassword(data.password);
  const t = nowIso();
  try {
    const info = getDb()
      .prepare(
        `INSERT INTO users (username, password_hash, role, active, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)`
      )
      .run(data.username.trim(), hash, data.role, t, t);
    return getDb()
      .prepare(
        "SELECT id, username, role, active, created_at, updated_at FROM users WHERE id = ?"
      )
      .get(info.lastInsertRowid) as Omit<UserRow, "password_hash">;
  } catch {
    throw new Error("用户名已存在");
  }
}

export function setUserActive(
  identity: Identity,
  userId: number,
  active: boolean
) {
  if (!requireAdmin(identity)) throw new Error("需要管理员权限");
  if (identity.kind === "user" && identity.userId === userId && !active) {
    throw new Error("不能禁用当前登录账号");
  }
  const user = getUserOrThrow(userId);
  assertCanTouchUser(identity, user);
  if (
    !active &&
    user.role === "superadmin" &&
    user.active &&
    countActiveSuperAdmins() <= 1
  ) {
    throw new Error("不能取消最后一个超级管理员");
  }
  getDb()
    .prepare("UPDATE users SET active = ?, updated_at = ? WHERE id = ?")
    .run(active ? 1 : 0, nowIso(), userId);
}

function getUserOrThrow(userId: number) {
  const user = getDb()
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(userId) as UserRow | undefined;
  if (!user) throw new Error("用户不存在");
  return user;
}

function countActiveAdmins() {
  const row = getDb()
    .prepare(
      "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1"
    )
    .get() as { c: number };
  return row.c;
}

function countSuperAdmins() {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'superadmin'")
    .get() as { c: number };
  return row.c;
}

function countActiveSuperAdmins() {
  const row = getDb()
    .prepare(
      "SELECT COUNT(*) AS c FROM users WHERE role = 'superadmin' AND active = 1"
    )
    .get() as { c: number };
  return row.c;
}

function assertAssignableRole(identity: Identity, role: Role) {
  if (role !== "user" && role !== "admin" && role !== "superadmin") {
    throw new Error("角色无效");
  }
  if (role === "superadmin" && identity.role !== "superadmin") {
    throw new Error("无权任命超级管理员");
  }
}

function assertCanTouchUser(identity: Identity, user: UserRow) {
  if (user.role === "superadmin" && identity.role !== "superadmin") {
    throw new Error("无权修改超级管理员");
  }
}

export async function updateUser(
  identity: Identity,
  userId: number,
  data: { username?: string; role?: Role; password?: string }
) {
  if (!requireAdmin(identity)) throw new Error("需要管理员权限");
  const user = getUserOrThrow(userId);

  const username =
    data.username !== undefined ? data.username.trim() : user.username;
  const role = data.role !== undefined ? data.role : user.role;
  const password = data.password;

  if (!username) throw new Error("用户名必填");
  assertAssignableRole(identity, role);
  assertCanTouchUser(identity, user);
  if (password !== undefined && password !== "" && password.length < 6) {
    throw new Error("密码至少 6 位");
  }

  if (
    user.role === "superadmin" &&
    role !== "superadmin" &&
    countSuperAdmins() <= 1
  ) {
    throw new Error("不能取消最后一个超级管理员");
  }

  if (
    user.role === "admin" &&
    user.active &&
    role === "user" &&
    countActiveAdmins() <= 1 &&
    countActiveSuperAdmins() === 0
  ) {
    throw new Error("不能取消最后一个管理员");
  }

  const t = nowIso();
  try {
    if (password) {
      const hash = await hashPassword(password);
      getDb()
        .prepare(
          `UPDATE users SET username = ?, role = ?, password_hash = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(username, role, hash, t, userId);
    } else {
      getDb()
        .prepare(
          `UPDATE users SET username = ?, role = ?, updated_at = ? WHERE id = ?`
        )
        .run(username, role, t, userId);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/UNIQUE|unique/i.test(msg)) throw new Error("用户名已存在");
    throw e;
  }

  return getDb()
    .prepare(
      "SELECT id, username, role, active, created_at, updated_at FROM users WHERE id = ?"
    )
    .get(userId) as Omit<UserRow, "password_hash">;
}

export function deleteUser(identity: Identity, userId: number) {
  if (!requireAdmin(identity)) throw new Error("需要管理员权限");
  if (identity.kind === "user" && identity.userId === userId) {
    throw new Error("不能删除当前登录账号");
  }
  const user = getUserOrThrow(userId);
  assertCanTouchUser(identity, user);
  if (user.role === "superadmin" && countSuperAdmins() <= 1) {
    throw new Error("不能删除最后一个超级管理员");
  }
  if (
    user.role === "admin" &&
    user.active &&
    countActiveAdmins() <= 1 &&
    countActiveSuperAdmins() === 0
  ) {
    throw new Error("不能删除最后一个管理员");
  }

  const db = getDb();
  const tx = db.transaction(() => {
    // api_keys.created_by_user_id 无 ON DELETE CASCADE，先清掉
    db.prepare("DELETE FROM api_keys WHERE created_by_user_id = ?").run(userId);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  });
  tx();
}

function parsePriority(raw?: string | null): Priority {
  const value = (raw || "p2") as Priority;
  if (value !== "p1" && value !== "p2" && value !== "p3") {
    throw new Error("优先级无效");
  }
  return value;
}

export function createBug(
  identity: Identity,
  data: {
    projectId: number;
    title: string;
    body?: string;
    priority?: Priority;
  }
) {
  getProject(identity, data.projectId);
  const title = data.title.trim();
  if (!title) throw new Error("标题必填");
  const priority = parsePriority(data.priority);
  const t = nowIso();
  const reporter =
    identity.kind === "user"
      ? { type: "user" as const, id: identity.userId }
      : { type: "api_key" as const, id: identity.apiKeyId };
  const bugId = getDb().transaction(() => {
    const project = getDb()
      .prepare("SELECT code FROM projects WHERE id = ?")
      .get(data.projectId) as { code: string } | undefined;
    if (!project?.code) throw new Error("项目缺少缩写");
    const existing = (
      getDb()
        .prepare("SELECT public_id FROM bugs WHERE public_id IS NOT NULL")
        .all() as { public_id: string }[]
    ).map((row) => row.public_id);
    const publicId = nextPublicId(project.code, t, existing);
    const info = getDb()
      .prepare(
        `INSERT INTO bugs (project_id, public_id, title, body, priority, status, reporter_type, reporter_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
      )
      .run(
        data.projectId,
        publicId,
        title,
        data.body?.trim() || "",
        priority,
        reporter.type,
        reporter.id,
        t,
        t
      );
    const id = Number(info.lastInsertRowid);
    getDb()
      .prepare(
        `INSERT INTO bug_status_events (bug_id, from_status, to_status, actor_type, actor_id, note, created_at)
         VALUES (?, NULL, 'pending', ?, ?, ?, ?)`
      )
      .run(id, reporter.type, reporter.id, "创建报障", t);
    getDb()
      .prepare("UPDATE projects SET updated_at = ? WHERE id = ?")
      .run(t, data.projectId);
    return id;
  })();
  return getBug(identity, bugId);
}

export const BUG_SORT_KEYS = [
  "id",
  "priority",
  "title",
  "status",
  "reporter",
  "handler",
  "created",
  "updated",
] as const;
export type BugSortKey = (typeof BUG_SORT_KEYS)[number];
export type SortDir = "asc" | "desc";

export type BugFilters = {
  status?: BugStatus;
  priority?: Priority;
  q?: string;
  sort?: string | null;
  dir?: string | null;
};

export type BugListItem = BugRow & {
  reporter_label: string;
  handler_label: string | null;
};

const REPORTER_LABEL_SQL = `CASE
  WHEN b.reporter_type = 'user' THEN COALESCE(u.username, '用户#' || b.reporter_id)
  ELSE COALESCE('Key:' || k.name, 'Key#' || b.reporter_id)
END`;

const HANDLER_LABEL_SQL = `CASE
  WHEN b.status = 'pending' OR h.id IS NULL THEN NULL
  WHEN h.actor_type = 'user' THEN COALESCE(hu.username, '用户#' || h.actor_id)
  ELSE COALESCE('Key:' || hk.name, 'Key#' || h.actor_id)
END`;

const BUG_ORDER_SQL: Record<BugSortKey, string> = {
  id: "b.public_id",
  priority: "b.priority",
  title: "b.title COLLATE NOCASE",
  status: `CASE b.status
    WHEN 'pending' THEN 0
    WHEN 'fixing' THEN 1
    WHEN 'awaiting_confirm' THEN 2
    WHEN 'confirmed' THEN 3
    WHEN 'invalid' THEN 4
    ELSE 5 END`,
  reporter: `(${REPORTER_LABEL_SQL}) COLLATE NOCASE`,
  handler: `COALESCE(${HANDLER_LABEL_SQL}, '') COLLATE NOCASE`,
  created: "b.created_at",
  updated: "b.updated_at",
};

export function resolveBugSort(
  sort?: string | null,
  dir?: string | null
): { sort: BugSortKey; dir: SortDir } {
  const key: BugSortKey = (BUG_SORT_KEYS as readonly string[]).includes(sort || "")
    ? (sort as BugSortKey)
    : "updated";
  if (dir === "asc" || dir === "desc") return { sort: key, dir };
  return {
    sort: key,
    dir: key === "updated" || key === "created" || key === "id" ? "desc" : "asc",
  };
}

export function listBugs(
  identity: Identity,
  projectId: number,
  filters: BugFilters = {}
) {
  getProject(identity, projectId);
  const where = ["b.project_id = ?"];
  const params: (string | number)[] = [projectId];
  if (filters.status) {
    where.push("b.status = ?");
    params.push(filters.status);
  }
  if (filters.priority) {
    where.push("b.priority = ?");
    params.push(filters.priority);
  }
  if (filters.q?.trim()) {
    where.push("(b.title LIKE ? OR b.public_id LIKE ?)");
    const term = `%${filters.q.trim()}%`;
    params.push(term, term);
  }
  const order = resolveBugSort(filters.sort, filters.dir);
  const sqlDir = order.dir === "asc" ? "ASC" : "DESC";
  return getDb()
    .prepare(
      `SELECT b.*, ${REPORTER_LABEL_SQL} AS reporter_label, ${HANDLER_LABEL_SQL} AS handler_label
       FROM bugs b
       LEFT JOIN users u ON b.reporter_type = 'user' AND u.id = b.reporter_id
       LEFT JOIN api_keys k ON b.reporter_type = 'api_key' AND k.id = b.reporter_id
       LEFT JOIN bug_status_events h ON h.id = (
         SELECT e.id FROM bug_status_events e
         WHERE e.bug_id = b.id
           AND e.to_status IN ('fixing', 'awaiting_confirm', 'invalid')
         ORDER BY e.id DESC
         LIMIT 1
       )
       LEFT JOIN users hu ON h.actor_type = 'user' AND hu.id = h.actor_id
       LEFT JOIN api_keys hk ON h.actor_type = 'api_key' AND hk.id = h.actor_id
       WHERE ${where.join(" AND ")}
       ORDER BY ${BUG_ORDER_SQL[order.sort]} ${sqlDir}, b.id ${sqlDir}`
    )
    .all(...params) as BugListItem[];
}

export function deleteBug(identity: Identity, bugId: number) {
  if (identity.role !== "superadmin") throw new Error("无权删除报障");
  const bug = getBug(identity, bugId);
  const db = getDb();
  const paths = db.transaction(() => {
    const files = db
      .prepare(
        `SELECT storage_path FROM attachments
         WHERE (owner_type = 'bug' AND owner_id = ?)
            OR (owner_type = 'status_event' AND owner_id IN (
              SELECT id FROM bug_status_events WHERE bug_id = ?
            ))`
      )
      .all(bugId, bugId) as { storage_path: string }[];
    db.prepare(
      `DELETE FROM attachments
       WHERE (owner_type = 'bug' AND owner_id = ?)
          OR (owner_type = 'status_event' AND owner_id IN (
            SELECT id FROM bug_status_events WHERE bug_id = ?
          ))`
    ).run(bugId, bugId);
    db.prepare("DELETE FROM bugs WHERE id = ?").run(bugId);
    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(
      nowIso(),
      bug.project_id
    );
    return files.map((f) => f.storage_path);
  })();

  for (const rel of paths) {
    try {
      fs.unlinkSync(absoluteAttachmentPath(rel));
    } catch {
      // 文件已不在磁盘上时，库记录仍然删除
    }
  }
}

export function getBug(identity: Identity, bugId: number) {
  const bug = getDb().prepare("SELECT * FROM bugs WHERE id = ?").get(bugId) as
    | BugRow
    | undefined;
  if (!bug) throw new Error("报障不存在");
  getProject(identity, bug.project_id);
  return bug;
}

export function updateBugPriority(
  identity: Identity,
  bugId: number,
  priority: Priority
) {
  if (!requireAdmin(identity)) throw new Error("需要管理员权限");
  const next = parsePriority(priority);
  const bug = getBug(identity, bugId);
  getDb()
    .prepare("UPDATE bugs SET priority = ?, updated_at = ? WHERE id = ?")
    .run(next, nowIso(), bug.id);
  return getBug(identity, bugId);
}

export function getBugEvents(identity: Identity, bugId: number) {
  getBug(identity, bugId);
  return getDb()
    .prepare(
      "SELECT * FROM bug_status_events WHERE bug_id = ? ORDER BY created_at ASC, id ASC"
    )
    .all(bugId) as StatusEventRow[];
}

export function getAttachments(
  ownerType: "bug" | "status_event",
  ownerId: number
) {
  return getDb()
    .prepare(
      "SELECT * FROM attachments WHERE owner_type = ? AND owner_id = ? ORDER BY id"
    )
    .all(ownerType, ownerId) as AttachmentRow[];
}

export function transitionBug(
  identity: Identity,
  bugId: number,
  action: TransitionAction,
  note?: string | null
) {
  const bug = getBug(identity, bugId);
  const result = validateTransition({
    action,
    from: bug.status,
    identity,
    reporterType: bug.reporter_type,
    reporterId: bug.reporter_id,
    note,
  });
  if (!result.ok) throw new Error(result.error);
  const t = nowIso();
  const actor = actorFromIdentity(identity);
  const tx = getDb().transaction(() => {
    getDb()
      .prepare("UPDATE bugs SET status = ?, updated_at = ? WHERE id = ?")
      .run(result.to, t, bugId);
    const info = getDb()
      .prepare(
        `INSERT INTO bug_status_events (bug_id, from_status, to_status, actor_type, actor_id, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        bugId,
        bug.status,
        result.to,
        actor.actorType,
        actor.actorId,
        note?.trim() || ACTION_LABEL[action],
        t
      );
    return Number(info.lastInsertRowid);
  });
  const eventId = tx();
  return { bug: getBug(identity, bugId), eventId };
}

export function bugActions(identity: Identity, bug: BugRow) {
  return allowedActions(
    identity,
    bug.status,
    bug.reporter_type,
    bug.reporter_id
  );
}

export function projectStats(
  identity: Identity,
  projectId: number,
  days: 7 | 30 | 90 = 30
) {
  getProject(identity, projectId);
  const counts = getDb()
    .prepare(
      `SELECT status, COUNT(*) AS c FROM bugs WHERE project_id = ? GROUP BY status`
    )
    .all(projectId) as { status: BugStatus; c: number }[];
  const byStatus: Record<BugStatus, number> = {
    pending: 0,
    fixing: 0,
    awaiting_confirm: 0,
    confirmed: 0,
    invalid: 0,
  };
  let total = 0;
  for (const row of counts) {
    byStatus[row.status] = row.c;
    total += row.c;
  }

  const daysList = recentShanghaiDateKeys(days);
  const sinceIso = shanghaiDayStartIso(daysList[0]);

  const createdSeries = getDb()
    .prepare(
      `SELECT ${shanghaiDaySql("created_at")} AS day, COUNT(*) AS c
       FROM bugs WHERE project_id = ? AND created_at >= ?
       GROUP BY day ORDER BY day`
    )
    .all(projectId, sinceIso) as { day: string; c: number }[];

  // GROUP BY 必须用 e.to_status：bugs 表也有 status 列，写成 status 会误分组
  const inflowSeries = getDb()
    .prepare(
      `SELECT ${shanghaiDaySql("e.created_at")} AS day, e.to_status AS to_status, COUNT(*) AS c
       FROM bug_status_events e
       JOIN bugs b ON b.id = e.bug_id
       WHERE b.project_id = ? AND e.created_at >= ? AND e.from_status IS NOT NULL
       GROUP BY day, e.to_status
       ORDER BY day`
    )
    .all(projectId, sinceIso) as {
    day: string;
    to_status: BugStatus;
    c: number;
  }[];

  const createdMap = Object.fromEntries(createdSeries.map((r) => [r.day, r.c]));
  const created = daysList.map((day) => ({ day, count: createdMap[day] || 0 }));

  const inflow: Record<string, Record<BugStatus, number>> = {};
  for (const day of daysList) {
    inflow[day] = {
      pending: 0,
      fixing: 0,
      awaiting_confirm: 0,
      confirmed: 0,
      invalid: 0,
    };
  }
  for (const row of inflowSeries) {
    if (!inflow[row.day]) continue;
    inflow[row.day][row.to_status] = row.c;
  }

  return {
    total,
    byStatus,
    labels: STATUS_LABEL,
    created,
    inflow: daysList.map((day) => ({ day, ...inflow[day] })),
    days,
  };
}

const BUG_STATUSES: BugStatus[] = [
  "pending",
  "fixing",
  "awaiting_confirm",
  "confirmed",
  "invalid",
];

function emptyStatusCounts(): StatusCounts {
  return {
    pending: 0,
    fixing: 0,
    awaiting_confirm: 0,
    confirmed: 0,
    invalid: 0,
  };
}

function isBugStatus(value: string): value is BugStatus {
  return (BUG_STATUSES as string[]).includes(value);
}

function countTotal(counts: StatusCounts) {
  return (
    counts.pending +
    counts.fixing +
    counts.awaiting_confirm +
    counts.confirmed +
    counts.invalid
  );
}

function countAdopted(counts: StatusCounts) {
  return counts.fixing + counts.awaiting_confirm + counts.confirmed;
}

export function parseAnalyticsRange(raw: string | undefined): AnalyticsRange {
  if (raw === "7" || raw === "30" || raw === "90") {
    return Number(raw) as 7 | 30 | 90;
  }
  return "all";
}

function analyticsSince(range: AnalyticsRange) {
  if (range === "all") return null;
  const days = recentShanghaiDateKeys(range);
  return shanghaiDayStartIso(days[0]);
}

export function reporterAnalytics(
  identity: Identity,
  range: AnalyticsRange = "all"
): ReporterAnalytics {
  if (!requireAdmin(identity)) throw new Error("需要管理员权限");
  const since = analyticsSince(range);
  const grouped = getDb()
    .prepare(
      `SELECT b.reporter_type AS reporter_type,
              b.reporter_id AS reporter_id,
              b.project_id AS project_id,
              p.name AS project_name,
              b.status AS status,
              COUNT(*) AS c
       FROM bugs b
       JOIN projects p ON p.id = b.project_id
       WHERE (? IS NULL OR b.created_at >= ?)
       GROUP BY b.reporter_type, b.reporter_id, b.project_id, p.name, b.status`
    )
    .all(since, since) as {
    reporter_type: "user" | "api_key";
    reporter_id: number;
    project_id: number;
    project_name: string;
    status: string;
    c: number;
  }[];

  const users = getDb()
    .prepare("SELECT id, username, active FROM users")
    .all() as { id: number; username: string; active: number }[];
  const keys = getDb()
    .prepare("SELECT id, name, disabled_at, revoked_at FROM api_keys")
    .all() as {
    id: number;
    name: string;
    disabled_at: string | null;
    revoked_at: string | null;
  }[];

  const byReporter = new Map<
    string,
    {
      reporterType: "user" | "api_key";
      reporterId: number;
      name: string;
      presence: ReporterPresence;
      counts: StatusCounts;
      projects: Map<number, ReporterProjectStat>;
    }
  >();

  function reporterKey(type: "user" | "api_key", id: number) {
    return `${type}:${id}`;
  }

  function ensureReporter(type: "user" | "api_key", id: number) {
    const key = reporterKey(type, id);
    const existing = byReporter.get(key);
    if (existing) return existing;
    const created = {
      reporterType: type,
      reporterId: id,
      name: type === "user" ? `已删除用户 #${id}` : `已删除 Key #${id}`,
      presence: "missing" as ReporterPresence,
      counts: emptyStatusCounts(),
      projects: new Map<number, ReporterProjectStat>(),
    };
    byReporter.set(key, created);
    return created;
  }

  for (const user of users) {
    const row = ensureReporter("user", user.id);
    row.name = user.username;
    row.presence = user.active ? "active" : "disabled";
  }
  for (const key of keys) {
    const row = ensureReporter("api_key", key.id);
    row.name = key.name;
    row.presence = key.revoked_at
      ? "revoked"
      : key.disabled_at
        ? "disabled"
        : "active";
  }

  const totals = emptyStatusCounts();
  for (const row of grouped) {
    if (!isBugStatus(row.status)) continue;
    const reporter = ensureReporter(row.reporter_type, row.reporter_id);
    reporter.counts[row.status] += row.c;
    totals[row.status] += row.c;
    let project = reporter.projects.get(row.project_id);
    if (!project) {
      project = {
        projectId: row.project_id,
        projectName: row.project_name,
        ...emptyStatusCounts(),
        total: 0,
        adopted: 0,
      };
      reporter.projects.set(row.project_id, project);
    }
    project[row.status] += row.c;
  }

  const reporters: ReporterStat[] = [...byReporter.values()]
    .map((row) => {
      const projects = [...row.projects.values()]
        .map((project) => ({
          ...project,
          total: countTotal(project),
          adopted: countAdopted(project),
        }))
        .sort(
          (a, b) =>
            b.total - a.total ||
            a.projectName.localeCompare(b.projectName, "zh")
        );
      return {
        reporterType: row.reporterType,
        reporterId: row.reporterId,
        name: row.name,
        presence: row.presence,
        ...row.counts,
        total: countTotal(row.counts),
        adopted: countAdopted(row.counts),
        projects,
      };
    })
    .sort(
      (a, b) =>
        b.total - a.total || a.name.localeCompare(b.name, "zh")
    );

  return {
    range,
    reporters,
    totals: {
      ...totals,
      total: countTotal(totals),
      adopted: countAdopted(totals),
      submitters: reporters.filter((row) => row.total > 0).length,
    },
  };
}

export function listApiKeys(identity: Identity) {
  if (!requireAdmin(identity)) throw new Error("需要管理员权限");
  return getDb()
    .prepare(
      `SELECT id, name, key_prefix, role, created_by_user_id, last_used_at, disabled_at, revoked_at, created_at
       FROM api_keys ORDER BY id DESC`
    )
    .all() as Omit<ApiKeyRow, "key_hash">[];
}

function getApiKeyOrThrow(keyId: number) {
  const row = getDb()
    .prepare(
      `SELECT id, name, key_prefix, role, created_by_user_id, last_used_at, disabled_at, revoked_at, created_at
       FROM api_keys WHERE id = ?`
    )
    .get(keyId) as Omit<ApiKeyRow, "key_hash"> | undefined;
  if (!row) throw new Error("API Key 不存在");
  return row;
}

function replaceApiKeyProjects(keyId: number, role: Role, projectIds?: number[]) {
  getDb()
    .prepare("DELETE FROM api_key_projects WHERE api_key_id = ?")
    .run(keyId);
  if (role === "user") {
    if (!projectIds || projectIds.length === 0) {
      throw new Error("用户级 Key 必须绑定至少一个项目");
    }
    const stmt = getDb().prepare(
      "INSERT INTO api_key_projects (api_key_id, project_id) VALUES (?, ?)"
    );
    for (const pid of projectIds) stmt.run(keyId, pid);
  }
}

export function createApiKey(
  identity: Identity,
  data: { name: string; role: Role; projectIds?: number[] }
) {
  if (!requireAdmin(identity)) throw new Error("需要管理员权限");
  if (!data.name.trim()) throw new Error("名称必填");
  if (data.role !== "user" && data.role !== "admin") {
    throw new Error("API Key 角色无效");
  }
  if (data.role === "user" && (!data.projectIds || data.projectIds.length === 0)) {
    throw new Error("用户级 Key 必须绑定至少一个项目");
  }
  if (identity.kind !== "user") {
    throw new Error("仅人类管理员可创建 API Key");
  }
  const generated = generateApiKey();
  const t = nowIso();
  const tx = getDb().transaction(() => {
    const info = getDb()
      .prepare(
        `INSERT INTO api_keys (name, key_hash, key_prefix, role, created_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.name.trim(),
        generated.hash,
        generated.prefix,
        data.role,
        identity.userId,
        t
      );
    const id = Number(info.lastInsertRowid);
    if (data.role === "user") {
      replaceApiKeyProjects(id, data.role, data.projectIds);
    }
    return id;
  });
  const id = tx();
  return { id, rawKey: generated.raw, prefix: generated.prefix };
}

export type ApiKeyUpdatePatch = {
  name?: string;
  role?: Role;
  projectIds?: number[];
  disabled?: boolean;
  regenerate?: boolean;
};

export function updateApiKey(
  identity: Identity,
  keyId: number,
  patch: ApiKeyUpdatePatch
) {
  if (!requireAdmin(identity)) throw new Error("需要管理员权限");
  if (identity.kind !== "user") {
    throw new Error("仅人类管理员可管理 API Key");
  }
  if (patch.role !== undefined && patch.role !== "user" && patch.role !== "admin") {
    throw new Error("API Key 角色无效");
  }
  const existing = getApiKeyOrThrow(keyId);
  const hasMeta =
    patch.name !== undefined ||
    patch.role !== undefined ||
    patch.projectIds !== undefined;
  const hasLifecycle =
    patch.disabled !== undefined || patch.regenerate === true;
  if (!hasMeta && !hasLifecycle) {
    throw new Error("无有效字段");
  }

  // Legacy rows may still have revoked_at; treat as immutable aside from delete.
  if (existing.revoked_at) {
    throw new Error("已吊销的 Key 不可修改");
  }

  if (patch.regenerate) {
    if (existing.disabled_at) {
      throw new Error("已禁用的 Key 不可重新生成");
    }
  }

  let rawKey: string | undefined;
  let prefix: string | undefined;

  const tx = getDb().transaction(() => {
    if (patch.disabled !== undefined) {
      getDb()
        .prepare("UPDATE api_keys SET disabled_at = ? WHERE id = ?")
        .run(patch.disabled ? nowIso() : null, keyId);
    }

    const nextRole = patch.role ?? existing.role;
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new Error("名称必填");
      getDb().prepare("UPDATE api_keys SET name = ? WHERE id = ?").run(name, keyId);
    }
    if (patch.role !== undefined) {
      getDb()
        .prepare("UPDATE api_keys SET role = ? WHERE id = ?")
        .run(patch.role, keyId);
    }
    if (patch.role !== undefined || patch.projectIds !== undefined) {
      const projectIds =
        patch.projectIds !== undefined
          ? patch.projectIds
          : (
              getDb()
                .prepare(
                  "SELECT project_id FROM api_key_projects WHERE api_key_id = ?"
                )
                .all(keyId) as { project_id: number }[]
            ).map((r) => r.project_id);
      replaceApiKeyProjects(keyId, nextRole, projectIds);
    }

    if (patch.regenerate) {
      const generated = generateApiKey();
      getDb()
        .prepare(
          "UPDATE api_keys SET key_hash = ?, key_prefix = ? WHERE id = ?"
        )
        .run(generated.hash, generated.prefix, keyId);
      rawKey = generated.raw;
      prefix = generated.prefix;
    }
  });
  tx();

  if (rawKey && prefix) return { ok: true as const, rawKey, prefix };
  return { ok: true as const };
}

export function deleteApiKey(identity: Identity, keyId: number) {
  if (!requireAdmin(identity)) throw new Error("需要管理员权限");
  getApiKeyOrThrow(keyId);
  getDb().prepare("DELETE FROM api_keys WHERE id = ?").run(keyId);
}

export function getBugHandlerLabel(bug: Pick<BugRow, "id" | "status">) {
  if (bug.status === "pending") return null;
  const event = getDb()
    .prepare(
      `SELECT actor_type, actor_id FROM bug_status_events
       WHERE bug_id = ? AND to_status IN ('fixing', 'awaiting_confirm', 'invalid')
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(bug.id) as { actor_type: "user" | "api_key"; actor_id: number } | undefined;
  if (!event) return null;
  return resolveActorLabel(event.actor_type, event.actor_id);
}

export function resolveActorLabel(
  actorType: "user" | "api_key",
  actorId: number
) {
  if (actorType === "user") {
    const u = getDb()
      .prepare("SELECT username FROM users WHERE id = ?")
      .get(actorId) as { username: string } | undefined;
    return u?.username || `用户#${actorId}`;
  }
  const k = getDb()
    .prepare("SELECT name FROM api_keys WHERE id = ?")
    .get(actorId) as { name: string } | undefined;
  return k ? `Key:${k.name}` : `Key#${actorId}`;
}

export function openBugCountsByProject(identity: Identity) {
  const projects = listProjects(identity);
  const result: Record<number, number> = {};
  for (const p of projects) {
    const row = getDb()
      .prepare(
        `SELECT COUNT(*) AS c FROM bugs
         WHERE project_id = ? AND status IN ('pending','fixing','awaiting_confirm')`
      )
      .get(p.id) as { c: number };
    result[p.id] = row.c;
  }
  return result;
}

export { hashApiKey, STATUS_LABEL, ACTION_LABEL };
