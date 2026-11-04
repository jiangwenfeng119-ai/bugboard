import type { Role } from "./types";

export function isAdminRole(role: Role | string) {
  return role === "admin" || role === "superadmin";
}

export function isSuperAdminRole(role: Role | string) {
  return role === "superadmin";
}

export function roleLabel(role: string) {
  if (role === "superadmin") return "超级管理员";
  if (role === "admin") return "管理员";
  return "用户";
}
