import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { requireAdminUser } from "@/lib/session-guard";
import { listApiKeys, listProjects, listUsers } from "@/lib/services";
import { getDb } from "@/lib/db";
import { UsersAdmin } from "./UsersAdmin";
import { ApiKeysAdmin } from "./ApiKeysAdmin";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const identity = await requireAdminUser();
  const users = listUsers(identity);
  const keys = listApiKeys(identity).map((k) => {
    const projectIds = (
      getDb()
        .prepare(
          "SELECT project_id FROM api_key_projects WHERE api_key_id = ?"
        )
        .all(k.id) as { project_id: number }[]
    ).map((r) => r.project_id);
    return { ...k, projectIds };
  });
  const projects = listProjects(identity);

  return (
    <AppShell username={identity.username} role={identity.role}>
      <div className="bb-page-head" style={{ flexDirection: "column", alignItems: "flex-start" }}>
        <Link href="/projects" className="bb-muted" style={{ fontSize: "0.9rem" }}>
          ← 返回项目
        </Link>
        <h1>管理后台</h1>
      </div>

      <section className="bb-card bb-section-card">
        <h2>用户</h2>
        <UsersAdmin
          users={users}
          currentUserId={identity.userId}
          actorRole={identity.role}
        />
      </section>

      <section className="bb-card bb-section-card">
        <h2>API Key</h2>
        <ApiKeysAdmin
          keys={keys}
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        />
      </section>
    </AppShell>
  );
}
