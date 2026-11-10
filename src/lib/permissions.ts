import { getDb } from "./db";
import { isAdminRole } from "./roles";
import type { Identity } from "./types";

export function projectAdminIds(identity: Identity, projectIds: number[]) {
  if (projectIds.length === 0) return new Set<number>();
  if (identity.kind === "api_key") {
    return isAdminRole(identity.role) ? new Set(projectIds) : new Set<number>();
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
