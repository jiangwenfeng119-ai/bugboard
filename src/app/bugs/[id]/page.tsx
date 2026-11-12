import fs from "fs";
import path from "path";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { PriorityMark } from "@/components/PriorityMark";
import { isProjectAdmin } from "@/lib/permissions";
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
import { bugListQueryFromUnknown } from "@/lib/bug-list-query";
import { absoluteAttachmentPath } from "@/lib/uploads";
import { extractDocx } from "../../../../mcp/docx";
import type { AttachmentRow, BugRow } from "@/lib/types";

export const dynamic = "force-dynamic";

function readList(raw: string) {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

type MediaKind = "image" | "video" | "audio" | "file";

function mediaKind(file: { filename: string; mime: string }): MediaKind {
  const mime = file.mime.toLowerCase();
  const name = file.filename.toLowerCase();
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/.test(name)) return "image";
  if (mime.startsWith("video/") || /\.(mp4|webm|mov)$/.test(name)) return "video";
  if (mime.startsWith("audio/") || /\.(mp3|wav|ogg|m4a)$/.test(name)) return "audio";
  return "file";
}

function hashedName(filename: string) {
  return /^[a-f0-9]{16,}(\.[a-z0-9]+)?$/i.test(filename);
}

function attachmentLabel(file: { filename: string; mime: string }, kind: MediaKind) {
  if (!hashedName(file.filename)) return file.filename;
  if (kind === "image") return "打开原图";
  if (kind === "video") return "下载视频";
  if (kind === "audio") return "下载音频";
  return "下载附件";
}

const PREVIEW_CHARS = 4000;

function attachmentPreview(file: AttachmentRow) {
  const ext = path.extname(file.filename).toLowerCase();
  if (ext !== ".docx" && ext !== ".txt" && ext !== ".md") return null;
  if (file.size > 2_000_000) return null;
  try {
    const buf = fs.readFileSync(absoluteAttachmentPath(file.storage_path));
    const text = ext === ".docx" ? extractDocx(buf).text : buf.toString("utf8");
    const trimmed = text.trim();
    if (!trimmed) return null;
    return {
      text: trimmed.slice(0, PREVIEW_CHARS),
      truncated: trimmed.length > PREVIEW_CHARS,
    };
  } catch {
    return null;
  }
}

function numberedLabel(file: AttachmentRow, files: AttachmentRow[]) {
  const kind = mediaKind(file);
  const base = attachmentLabel(file, kind);
  if (!hashedName(file.filename)) return base;
  const same = files.filter(
    (item) => mediaKind(item) === kind && hashedName(item.filename)
  );
  if (same.length < 2) return base;
  return `${base} ${same.findIndex((item) => item.id === file.id) + 1}`;
}

function AttachmentItem({
  file,
  files,
}: {
  file: AttachmentRow;
  files: AttachmentRow[];
}) {
  const kind = mediaKind(file);
  const href = `/api/attachments/${file.id}`;
  const label = numberedLabel(file, files);
  const preview = kind === "file" ? attachmentPreview(file) : null;
  return (
    <li>
      {kind === "image" ? (
        // 附件地址由本系统签发。
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="bb-evidence-img"
          src={href}
          alt={hashedName(file.filename) ? label : file.filename}
        />
      ) : null}
      {kind === "video" ? (
        <video className="bb-evidence-video" controls preload="metadata" src={href} />
      ) : null}
      {kind === "audio" ? (
        <audio className="bb-evidence-audio" controls preload="metadata" src={href} />
      ) : null}
      {preview ? (
        <>
          <pre className="bb-attachment-text">{preview.text}</pre>
          {preview.truncated ? (
            <p className="bb-muted">只显示前 {PREVIEW_CHARS} 字，完整内容请下载。</p>
          ) : null}
        </>
      ) : null}
      <a href={href} target="_blank" rel="noreferrer">
        {label}
      </a>{" "}
      <span className="bb-muted">({Math.round(file.size / 1024)} KB)</span>
    </li>
  );
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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  const identity = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const listQuery = bugListQueryFromUnknown(sp.back);
  const bug = getBug(identity, Number(id));
  const project = getProject(identity, bug.project_id);
  const projects = listProjects(identity);
  const events = getBugEvents(identity, bug.id);
  const attachments = getAttachments("bug", bug.id);
  const actions = bugActions(identity, bug);
  const canHandleBugs = isProjectAdmin(identity, bug.project_id);
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
      <Link
        href={`/projects/${project.id}/bugs${listQuery ? `?${listQuery}` : ""}`}
        className="bb-crumb"
      >
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
              isAdmin={canHandleBugs}
              currentPriority={bug.priority}
            />
          </div>
          {wakeEnabled || wakeLatest ? (
            <div className="bb-card bb-section-card">
              <h2>分派去修理</h2>
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
              <ul className="bb-attachment-list">
                {attachments.map((a) => (
                  <AttachmentItem key={a.id} file={a} files={attachments} />
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
                      <ul className="bb-attachment-list">
                        {eventAtt.map((a) => (
                          <AttachmentItem key={a.id} file={a} files={eventAtt} />
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
      <Link
        href={`/projects/${project.id}/bugs${listQuery ? `?${listQuery}` : ""}`}
        className="bb-crumb bb-crumb-end"
      >
        ← {project.name} / 报障
      </Link>
    </AppShell>
  );
}
