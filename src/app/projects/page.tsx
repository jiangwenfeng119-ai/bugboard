import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { IconArrowRight, IconFolder } from "@/components/Icons";
import { isAdminRole, isSuperAdminRole } from "@/lib/roles";
import { requireUser } from "@/lib/session-guard";
import {
  listProjects,
  openBugCountsByProject,
  type ProjectAttentionCounts,
} from "@/lib/services";
import type { Role } from "@/lib/types";
import { CreateProjectForm } from "./CreateProjectForm";
import { DeleteProjectButton } from "./DeleteProjectButton";

export const dynamic = "force-dynamic";

function attentionChips(
  projectId: number,
  counts: ProjectAttentionCounts,
  viewer: { role: Role; userId: number }
) {
  const admin = isAdminRole(viewer.role);
  const confirm = {
    key: "awaiting",
    count: counts.awaitingConfirm,
    label: "待确认",
    title: admin ? "整个项目里等待确认的报障" : "你提交的、等待你确认的报障",
    href: admin
      ? `/projects/${projectId}/bugs?status=awaiting_confirm`
      : `/projects/${projectId}/bugs?status=awaiting_confirm&reporter=user:${viewer.userId}`,
    tone: "awaiting",
  };
  const supplement = {
    key: "needs",
    count: counts.needsInfo,
    label: "待补充",
    title: admin ? "整个项目里等待补充材料的报障" : "你提交的、还要补材料的报障",
    href: admin
      ? `/projects/${projectId}/bugs?status=needs_info`
      : `/projects/${projectId}/bugs?status=needs_info&reporter=user:${viewer.userId}`,
    tone: "needs",
  };
  if (!admin) return [supplement, confirm];
  return [
    {
      key: "pending",
      count: counts.pending,
      label: "待处理",
      title: "新提交和打回后需要继续处理的报障",
      href: `/projects/${projectId}/bugs?status=pending`,
      tone: "pending",
    },
    supplement,
    confirm,
  ];
}

export default async function ProjectsPage() {
  const identity = await requireUser();
  const projects = listProjects(identity);
  const openCounts = openBugCountsByProject(identity);
  const canManage = isAdminRole(identity.role);
  const canDelete = isSuperAdminRole(identity.role);

  return (
    <AppShell username={identity.username} role={identity.role}>
      <div className="bb-page-head">
        <div>
          <h1 className="bb-title-with-icon">
            <span className="bb-title-icon" aria-hidden>
              <IconFolder size={22} />
            </span>
            项目
          </h1>
          <p className="bb-muted" style={{ margin: "0.4rem 0 0" }}>
            进入项目即打开报障列表
          </p>
        </div>
        {canManage ? <CreateProjectForm /> : null}
      </div>

      {projects.length === 0 ? (
        <EmptyState
          imageSrc="/brand/empty-projects.png"
          title={canManage ? "还没有项目" : "暂无可见项目"}
          description={
            canManage
              ? "创建第一个项目，开始报障闭环。"
              : "你还没有被分配到任何项目，请联系管理员。"
          }
          action={canManage ? <CreateProjectForm /> : null}
        />
      ) : (
        <div className="bb-project-grid">
          {projects.map((p) => {
            const counts = openCounts[p.id] ?? {
              pending: 0,
              awaitingConfirm: 0,
              needsInfo: 0,
              open: 0,
            };
            const bugsHref = `/projects/${p.id}/bugs`;
            return (
              <div
                key={p.id}
                className={`bb-card bb-project-card bb-card-interactive${canDelete ? " has-remove" : ""}`}
              >
                {canDelete ? (
                  <DeleteProjectButton
                    projectId={p.id}
                    projectName={p.name}
                    compact
                  />
                ) : null}
                <div className="bb-project-card-top">
                  <Link href={bugsHref} className="bb-project-icon" aria-label={`打开${p.name}`}>
                    <IconFolder size={20} />
                  </Link>
                  <div className="bb-open-chips">
                    {attentionChips(p.id, counts, identity).map((chip) => (
                      <Link
                        key={chip.key}
                        href={chip.href}
                        className={`bb-open-chip${chip.count > 0 ? ` is-hot is-${chip.tone}` : ""}`}
                        title={chip.title}
                      >
                        {chip.count} {chip.label}
                      </Link>
                    ))}
                  </div>
                </div>
                <Link href={bugsHref} className="bb-project-card-link">
                  <h2 className="bb-project-name">{p.name}</h2>
                  {p.description ? (
                    <p className="bb-muted bb-project-desc">{p.description}</p>
                  ) : null}
                </Link>
                <div className="bb-project-card-foot">
                  <code className="bb-slug">{p.slug}</code>
                  <Link href={`/projects/${p.id}/bugs`} className="bb-enter-link">
                    进入 <IconArrowRight size={14} />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
