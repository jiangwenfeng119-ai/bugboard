import { getDb } from "./db";
import { isAdminRole } from "./roles";
import type { Identity } from "./types";

export function projectAdminIds(identity: Identity, projectIds: number[]) {
  if (projectIds.length === 0) return new Set<number>();
  if (identity.kind === "api_key") {
    if (!isAdminRole(identity.role)) return new Set<number>();
    // Empty bindings = all visible projects; otherwise only bound ones.
    if (identity.projectIds.length === 0) return new Set(projectIds);
    return new Set(projectIds.filter((id) => identity.projectIds.includes(id)));
  }
  const placeholders = projectIds.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT project_id FROM project_members
       WHERE user_id = ? AND role = 'admin' AND project_id IN (${placeholders})`
    )
    .all(identity.userId, ...projectIds) as { project_id: number }[];
  return new Set(rows.map((row) => row.project_id));
}

export function isProjectAdmin(identity: Identity, projectId: number) {
  return projectAdminIds(identity, [projectId]).has(projectId);
}

export function canAccessProject(identity: Identity, projectId: number) {
  if (identity.kind === "api_key" && isAdminRole(identity.role)) {
    if (identity.projectIds.length === 0) return true;
    return identity.projectIds.includes(projectId);
  }
  if (isAdminRole(identity.role)) return true;
  if (identity.kind === "api_key") {
    return identity.projectIds.includes(projectId);
  }
  const row = getDb()
    .prepare(
      "SELECT 1 AS ok FROM project_members WHERE project_id = ? AND user_id = ?"
    )
    .get(projectId, identity.userId) as { ok: number } | undefined;
  return !!row;
}

export function listAccessibleProjectIds(identity: Identity): number[] | "all" {
  if (identity.kind === "api_key" && isAdminRole(identity.role)) {
    return identity.projectIds.length === 0 ? "all" : identity.projectIds;
  }
  if (isAdminRole(identity.role)) return "all";
  if (identity.kind === "api_key") return identity.projectIds;
  return (
    getDb()
      .prepare("SELECT project_id FROM project_members WHERE user_id = ?")
      .all(identity.userId) as { project_id: number }[]
  ).map((r) => r.project_id);
}

export function requireAdmin(identity: Identity) {
  return isAdminRole(identity.role);
}
