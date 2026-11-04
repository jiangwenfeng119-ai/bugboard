import { getDb } from "./db";
import { isAdminRole } from "./roles";
import type { Identity } from "./types";

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
