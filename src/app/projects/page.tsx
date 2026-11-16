import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { IconArrowRight, IconFolder } from "@/components/Icons";
import { projectLogoSrc } from "@/lib/project-logo-shared";
import { resolveProjectSort, sortProjects } from "@/lib/project-sort";
import { isAdminRole, isSuperAdminRole } from "@/lib/roles";
import { requireUser } from "@/lib/session-guard";
import {
  bugTotalsByProject,
  listInbox,
  listProjects,
  openBugCountsByProject,
  type ProjectAttentionCounts,
} from "@/lib/services";
import type { Role } from "@/lib/types";
import { CreateProjectForm } from "./CreateProjectForm";
import { DeleteProjectButton } from "./DeleteProjectButton";
import { InboxSection } from "./InboxSection";
import { ProjectSortSelect } from "./ProjectSortSelect";

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
    {
      key: "ready",
      count: counts.readyToRelease,
      label: "待发布",
      title: "已提交修复、尚未发布到验收环境的报障",
      href: `/projects/${projectId}/bugs?status=ready_to_release`,
      tone: "ready",
    },
    confirm,
  ];
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const identity = await requireUser();
  const sp = await searchParams;
  const sort = resolveProjectSort(sp.sort);
  const projects = sortProjects(listProjects(identity), sort, bugTotalsByProject(identity));
  const inbox = listInbox(identity);
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
        <div className="bb-page-head-actions">
          {projects.length > 0 ? <ProjectSortSelect sort={sort} /> : null}
          {canManage ? <CreateProjectForm /> : null}
        </div>
      </div>

      <InboxSection inbox={inbox} />

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
              readyToRelease: 0,
              open: 0,
            };
            const bugsHref = `/projects/${p.id}/bugs`;
            const logoSrc = p.logo_path ? projectLogoSrc(p.id, p.updated_at) : "";
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
                  <Link
                    href={bugsHref}
                    className={`bb-project-icon${logoSrc ? " has-logo" : ""}`}
                    aria-label={`打开${p.name}`}
                  >
                    {logoSrc ? (
                      // 登录后的项目图，浏览器直接带上 cookie，不用图片优化器。
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logoSrc} alt="" />
                    ) : (
                      <IconFolder size={20} />
                    )}
                  </Link>
                  <div className="bb-open-chips">
                    {(() => {
                      const hot = attentionChips(p.id, counts, identity).filter(
                        (chip) => chip.count > 0
                      );
                      if (hot.length === 0) {
                        return (
                          <span className="bb-open-chip is-quiet" title="暂时没有需要跟进的报障">
                            暂无待办
                          </span>
                        );
                      }
                      return hot.map((chip) => (
                        <Link
                          key={chip.key}
                          href={chip.href}
                          className={`bb-open-chip is-hot is-${chip.tone}`}
                          title={chip.title}
                        >
                          {chip.count} {chip.label}
                        </Link>
                      ));
                    })()}
                  </div>
                </div>
                <Link href={bugsHref} className="bb-project-card-link">
                  <h2 className="bb-project-name" title={p.name}>
                    {p.name}
                  </h2>
                  <p
                    className="bb-muted bb-project-desc"
                    title={p.description || undefined}
                    aria-hidden={p.description ? undefined : true}
                  >
                    {p.description}
                  </p>
                </Link>
                <div className="bb-project-card-foot">
                  <code className="bb-slug" title={p.code}>
                    {p.code}
                  </code>
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
