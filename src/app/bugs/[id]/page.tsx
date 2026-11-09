import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { PriorityMark } from "@/components/PriorityMark";
import { isAdminRole } from "@/lib/roles";
import { requireUser } from "@/lib/session-guard";
import { formatDateTime } from "@/lib/time";
import {
  bugActions,
  getAttachments,
  getBug,
  getBugEvents,
  getBugHandlerLabel,
  getProject,
  listProjects,
  resolveActorLabel,
} from "@/lib/services";
import { STATUS_LABEL } from "@/lib/types";
import { WakeBugButton } from "@/components/AgentDispatch";
import { latestDispatch, projectWakeEnabled } from "@/lib/dispatch";
import { BugActions } from "./BugActions";
import { ProjectSwitcher } from "@/app/projects/[id]/ProjectSwitcher";
import { Prose } from "@/components/Prose";
import type { BugRow } from "@/lib/types";

export const dynamic = "force-dynamic";

function readList(raw: string) {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function isImageName(filename: string) {
  return /\.(png|jpe?g|gif|webp)$/i.test(filename);
}

function EvidenceCard({ bug }: { bug: BugRow }) {
  const steps = readList(bug.steps_json || "[]");
  const has =
    bug.quote ||
    steps.length ||
    bug.open_question ||
    bug.source_url ||
    bug.evidence_sec != null ||
    bug.confidence === "low";
  if (!has) return null;
  return (
    <div className="bb-card bb-section-card">
      <h2>证据</h2>
      {bug.confidence === "low" && bug.open_question ? (
        <p className="bb-cap-question">{bug.open_question}</p>
      ) : null}
      {bug.quote ? <p>{bug.quote}</p> : null}
      {bug.evidence_sec != null ? (
        <p className="bb-muted">录像时间点 {bug.evidence_sec}s</p>
      ) : null}
      {bug.source_url ? (
        <p>
          <a href={bug.source_url} target="_blank" rel="noreferrer">
            {bug.source_url}
          </a>
        </p>
      ) : null}
      {steps.length ? (
        <ol>
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}
      {bug.capture_session_id ? (
        <p className="bb-muted">
          <Link href={`/projects/${bug.project_id}/captures/${bug.capture_session_id}`}>来自走查</Link>
        </p>
      ) : null}
    </div>
  );
}

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
  const isAdmin = isAdminRole(identity.role);
  const wakeLatest = isAdmin ? latestDispatch(bug.id) : null;
  const wakeEnabled = isAdmin && projectWakeEnabled(bug.project_id);

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
      <Link href={`/projects/${project.id}/bugs`} className="bb-crumb">
        ← {project.name} / 报障
      </Link>

      <div className="bb-bug-title">
        <div className="bb-bug-title-marks">
          <PriorityMark priority={bug.priority} />
          <StatusBadge status={bug.status} />
        </div>
        <h1>{bug.title}</h1>
      </div>
      <p className="bb-muted bb-bug-meta">
        <span className="bb-bug-id">{bug.public_id}</span>
        {" · "}
        提交人 {resolveActorLabel(bug.reporter_type, bug.reporter_id)}
        {" · "}
        处理人 {getBugHandlerLabel(bug) || "—"}
        {" · "}
        创建 {formatDateTime(bug.created_at)}
        {" · "}
        更新 {formatDateTime(bug.updated_at)}
      </p>

      <div className="bb-bug-layout">
        <aside className="bb-bug-aside">
          <div className="bb-card bb-section-card">
            <h2>下一步</h2>
            <BugActions
              bugId={bug.id}
              actions={actions}
              isAdmin={isAdmin}
              currentPriority={bug.priority}
            />
          </div>
          {wakeEnabled || wakeLatest ? (
            <div className="bb-card bb-section-card">
              <h2>叫醒</h2>
              <WakeBugButton
                bugId={bug.id}
                canWake={wakeEnabled && bug.status === "pending"}
                initial={wakeLatest}
              />
            </div>
          ) : null}
        </aside>

        <div className="bb-bug-main">
          <EvidenceCard bug={bug} />

          <div className="bb-card bb-section-card">
            <h2>描述</h2>
            <Prose text={bug.body} empty="（无描述）" />
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
                    {isImageName(a.filename) ? (
                      // 附件地址由本系统签发。
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="bb-evidence-img" src={`/api/attachments/${a.id}`} alt={a.filename} />
                    ) : null}
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
                        {formatDateTime(e.created_at)}
                      </span>
                    </div>
                    {e.note ? <Prose text={e.note} /> : null}
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
        </div>
      </div>
    </AppShell>
  );
}
