import Link from "next/link";
import { listCaptureSessions } from "@/lib/captures";
import { EmptyState } from "@/components/EmptyState";
import { requireUser } from "@/lib/session-guard";
import { formatDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function CapturesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const identity = await requireUser();
  const { id } = await params;
  const projectId = Number(id);
  const sessions = listCaptureSessions(identity, projectId);

  return (
    <div className="bb-bugs-page">
      {sessions.length === 0 ? (
        <EmptyState
          imageSrc="/brand/empty-bugs.png"
          title="还没有走查"
          description="在新建报障里选「录一段走查」。录完会先变成草稿，看完才进入待处理。"
        />
      ) : (
        <ul className="bb-cap-sessions">
          {sessions.map((session) => (
            <li key={session.id}>
              <Link href={`/projects/${projectId}/captures/${session.id}`} className="bb-card bb-cap-session">
                <strong>{session.title}</strong>
                <span className="bb-muted">
                  {session.status === "review" ? `${session.openCount} 条待看` : "已整理"}
                  {" · "}
                  {formatDateTime(session.createdAt)}
                  {session.truncated ? " · 录像已截断" : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
