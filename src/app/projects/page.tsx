import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { IconArrowRight, IconFolder } from "@/components/Icons";
import { isAdminRole, isSuperAdminRole } from "@/lib/roles";
import { requireUser } from "@/lib/session-guard";
import { listProjects, openBugCountsByProject } from "@/lib/services";
import { CreateProjectForm } from "./CreateProjectForm";
import { DeleteProjectButton } from "./DeleteProjectButton";

export const dynamic = "force-dynamic";

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
            const open = openCounts[p.id] || 0;
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
                <Link href={`/projects/${p.id}/bugs`} className="bb-project-card-link">
                  <div className="bb-project-card-top">
                    <span className="bb-project-icon" aria-hidden>
                      <IconFolder size={20} />
                    </span>
                    <span
                      className={`bb-open-chip${open > 0 ? " is-hot" : ""}`}
                      title="处理中的报障"
                    >
                      {open} 处理中
                    </span>
                  </div>
                  <h2 className="bb-project-name">{p.name}</h2>
                  <p className="bb-muted bb-project-desc">
                    {p.description || "暂无项目说明"}
                  </p>
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
