import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { PriorityMark } from "@/components/PriorityMark";
import { isAdminRole } from "@/lib/roles";
import { requireUser } from "@/lib/session-guard";
import {
  bugActions,
  getAttachments,
  getBug,
  getBugEvents,
  getProject,
  listProjects,
  resolveActorLabel,
} from "@/lib/services";
import { STATUS_LABEL } from "@/lib/types";
import { BugActions } from "./BugActions";
import { ProjectSwitcher } from "@/app/projects/[id]/ProjectSwitcher";

export const dynamic = "force-dynamic";

export default async function BugDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const identity = await requireUser();
  const { id } = await params;
  const bug = getBug(identity, Number(id));
  const project = getProject(identity, bug.project_id);
  const projects = listProjects(identity);
  const events = getBugEvents(identity, bug.id);
  const attachments = getAttachments("bug", bug.id);
  const actions = bugActions(identity, bug);

  return (
    <AppShell
      username={identity.username}
      role={identity.role}
      projectSwitcher={
        <ProjectSwitcher
          currentId={project.id}
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        />
      }
    >
      <Link
        href={`/projects/${project.id}/bugs`}
        className="bb-muted"
        style={{ fontSize: "0.9rem" }}
      >
        ← {project.name} / 报障
      </Link>

      <div className="bb-bug-title" style={{ marginTop: "0.55rem" }}>
        <div className="bb-bug-title-marks">
          <PriorityMark priority={bug.priority} />
          <StatusBadge status={bug.status} />
        </div>
        <h1>{bug.title}</h1>
      </div>
      <p className="bb-muted" style={{ margin: "0.4rem 0 1rem" }}>
        创建人 {resolveActorLabel(bug.reporter_type, bug.reporter_id)} ·{" "}
        {new Date(bug.created_at).toLocaleString("zh-CN")} · 更新{" "}
        {new Date(bug.updated_at).toLocaleString("zh-CN")}
      </p>

      <div className="bb-card bb-section-card">
        <h2>描述</h2>
        <p style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>
          {bug.body || "（无描述）"}
        </p>
      </div>

      <div className="bb-card bb-section-card">
        <h2>附件</h2>
        {attachments.length === 0 ? (
          <p className="bb-muted" style={{ margin: 0 }}>
            无附件
          </p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
            {attachments.map((a) => (
              <li key={a.id}>
                <a href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer">
                  {a.filename}
                </a>{" "}
                <span className="bb-muted">
                  ({Math.round(a.size / 1024)} KB)
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bb-card bb-section-card">
        <h2>下一步</h2>
        <BugActions
          bugId={bug.id}
          actions={actions}
          isAdmin={isAdminRole(identity.role)}
          currentPriority={bug.priority}
        />
      </div>

      <div className="bb-card bb-section-card">
        <h2>状态时间线</h2>
        <ul className="bb-timeline">
          {events.map((e) => {
            const eventAtt = getAttachments("status_event", e.id);
            return (
              <li key={e.id}>
                <div>
                  <strong>
                    {e.from_status
                      ? `${STATUS_LABEL[e.from_status]} → ${STATUS_LABEL[e.to_status]}`
                      : STATUS_LABEL[e.to_status]}
                  </strong>{" "}
                  <span className="bb-muted">
                    · {resolveActorLabel(e.actor_type, e.actor_id)} ·{" "}
                    {new Date(e.created_at).toLocaleString("zh-CN")}
                  </span>
                </div>
                {e.note ? (
                  <p style={{ margin: "0.25rem 0 0", whiteSpace: "pre-wrap" }}>
                    {e.note}
                  </p>
                ) : null}
                {eventAtt.length > 0 ? (
                  <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1rem" }}>
                    {eventAtt.map((a) => (
                      <li key={a.id}>
                        <a
                          href={`/api/attachments/${a.id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {a.filename}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </AppShell>
  );
}
