import { getCaptureSession } from "@/lib/captures";
import { requireUser } from "@/lib/session-guard";
import { CaptureReview } from "../CaptureReview";

export const dynamic = "force-dynamic";

export default async function CaptureSessionPage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const identity = await requireUser();
  const { id, sessionId } = await params;
  const session = getCaptureSession(identity, Number(sessionId));
  return <CaptureReview projectId={Number(id)} initial={session} />;
}
