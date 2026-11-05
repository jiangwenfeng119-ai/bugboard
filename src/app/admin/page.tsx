import { existsSync } from "node:fs";
import path from "node:path";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { IconChart, IconKey, IconPencil, IconUsers } from "@/components/Icons";
import { requireAdminUser } from "@/lib/session-guard";
import {
  listApiKeys,
  listProjects,
  listUsers,
  parseAnalyticsRange,
  reporterAnalytics,
} from "@/lib/services";
import { getDb } from "@/lib/db";
import { UsersAdmin } from "./UsersAdmin";
import { ApiKeysAdmin } from "./ApiKeysAdmin";
import { AnalyticsAdmin } from "./AnalyticsAdmin";
import { AgentPromptsAdmin } from "./AgentPromptsAdmin";

export const dynamic = "force-dynamic";

const TABS = [
  { id: "users", href: "/admin", label: "用户", icon: IconUsers },
  { id: "keys", href: "/admin?tab=keys", label: "API Key", icon: IconKey },
  { id: "analytics", href: "/admin?tab=analytics", label: "数据分析", icon: IconChart },
  { id: "prompts", href: "/admin?tab=prompts", label: "提示词", icon: IconPencil },
] as const;

function localMcpScriptPath() {
  const script = path.join(process.cwd(), "mcp", "server.ts");
  const pkg = path.join(process.cwd(), "package.json");
  return existsSync(script) && existsSync(pkg) ? script : null;
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; range?: string }>;
}) {
  const identity = await requireAdminUser();
  const sp = await searchParams;
  const tab =
    sp.tab === "keys" || sp.tab === "analytics" || sp.tab === "prompts"
      ? sp.tab
      : "users";

  return (
    <AppShell username={identity.username} role={identity.role}>
      <div className="bb-page-head">
        <div>
          <Link href="/projects" className="bb-crumb">
            ← 返回项目
          </Link>
          <h1>管理后台</h1>
        </div>
      </div>

      <nav className="bb-tabs" aria-label="管理分区">
        {TABS.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.id}
              href={item.href}
              className="bb-tab"
              aria-current={tab === item.id ? "page" : undefined}
            >
              <span className="bb-tab-icon" aria-hidden>
                <Icon size={15} />
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {tab === "users" ? (
        <section className="bb-card bb-section-card">
          <h2>用户</h2>
          <UsersAdmin
            users={listUsers(identity)}
            currentUserId={identity.userId}
            actorRole={identity.role}
          />
        </section>
      ) : null}

      {tab === "keys" ? (
        <section className="bb-card bb-section-card bb-keys-panel">
          <h2>API Key</h2>
          <ApiKeysAdmin
            keys={listApiKeys(identity).map((k) => {
              const projectIds = (
                getDb()
                  .prepare("SELECT project_id FROM api_key_projects WHERE api_key_id = ?")
                  .all(k.id) as { project_id: number }[]
              ).map((r) => r.project_id);
              return { ...k, projectIds };
            })}
            projects={listProjects(identity).map((p) => ({ id: p.id, name: p.name }))}
            mcpScriptPath={localMcpScriptPath()}
            configuredBaseUrl={process.env.BASE_URL?.trim() || null}
          />
        </section>
      ) : null}

      {tab === "analytics" ? (
        <AnalyticsAdmin stats={reporterAnalytics(identity, parseAnalyticsRange(sp.range))} />
      ) : null}

      {tab === "prompts" ? <AgentPromptsAdmin /> : null}
    </AppShell>
  );
}
