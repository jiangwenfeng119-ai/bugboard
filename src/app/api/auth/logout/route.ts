import { getSession } from "@/lib/auth";
import { json } from "@/lib/http";

export const runtime = "nodejs";

export async function POST() {
  const session = await getSession();
  session.destroy();
  return json({ ok: true });
}
