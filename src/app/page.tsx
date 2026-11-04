import { redirect } from "next/navigation";
import { isSetupComplete } from "@/lib/db";
import { resolveSessionIdentity } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!isSetupComplete()) redirect("/setup");
  const identity = await resolveSessionIdentity();
  if (!identity) redirect("/login");
  redirect("/projects");
}
