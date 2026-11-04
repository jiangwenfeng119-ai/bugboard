import { redirect } from "next/navigation";
import { resolveSessionIdentity } from "./auth";
import { isSetupComplete } from "./db";
import { isAdminRole } from "./roles";

export async function requireUser() {
  if (!isSetupComplete()) redirect("/setup");
  const identity = await resolveSessionIdentity();
  if (!identity || identity.kind !== "user") redirect("/login");
  return identity;
}

export async function requireAdminUser() {
  const identity = await requireUser();
  if (!isAdminRole(identity.role)) redirect("/projects");
  return identity;
}
