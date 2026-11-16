import { redirect } from "next/navigation";
import { resolveSessionIdentity } from "@/lib/auth";
import { isSetupComplete } from "@/lib/db";
import { setupPageRedirect } from "@/lib/setup-entry";
import { SetupForm } from "./SetupForm";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const target = setupPageRedirect(isSetupComplete(), (await resolveSessionIdentity()) !== null);
  if (target) redirect(target);
  return <SetupForm />;
}
