import { AppShell } from "@/components/AppShell";
import { isAdminRole, isSuperAdminRole } from "@/lib/roles";
import { requireUser } from "@/lib/session-guard";
import { getProject, listProjects } from "@/lib/services";
import { ProjectHeader } from "./ProjectHeader";
import { ProjectTabs } from "./ProjectTabs";
import { ProjectSwitcher } from "./ProjectSwitcher";

export const dynamic = "force-dynamic";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const identity = await requireUser();
  const { id } = await params;
  const projectId = Number(id);
  const project = getProject(identity, projectId);
  const projects = listProjects(identity);

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
      <ProjectHeader
        projectId={project.id}
        name={project.name}
        description={project.description}
        isAdmin={isAdminRole(identity.role)}
        canDelete={isSuperAdminRole(identity.role)}
      />
      <ProjectTabs
        projectId={project.id}
        isAdmin={isAdminRole(identity.role)}
      />
      {children}
    </AppShell>
  );
}
