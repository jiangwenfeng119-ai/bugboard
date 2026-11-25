import { existsSync } from "node:fs";
import path from "node:path";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { DispatchAdmin } from "@/components/AgentDispatch";
import { IconBell, IconChart, IconKey, IconMessage, IconPencil, IconUsers, IconWrench } from "@/components/Icons";
import {
  askOptimizeQueue,
  listAskAdminRecords,
  listAskOptimizations,
  readAskAdminRecord,
  readAskOptimization,
} from "@/lib/ask-optimize";
import { getBehaviorSettings, listBehaviorOverviews } from "@/lib/behavior";
import { dispatchRuntimeStatus, getDispatchSettings, listDispatchOverviews } from "@/lib/dispatch";
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
import { BehaviorAdmin } from "./BehaviorAdmin";
import { AsksAdmin } from "./AsksAdmin";

export const dynamic = "force-dynamic";

const TABS = [
  { id: "analytics", href: "/admin", label: "数据分析", icon: IconChart },
  { id: "users", href: "/admin?tab=users", label: "用户", icon: IconUsers },
  { id: "keys", href: "/admin?tab=keys", label: "API Key", icon: IconKey },
  { id: "wake", href: "/admin?tab=wake", label: "分派给 Agent", icon: IconBell },
  { id: "behavior", href: "/admin?tab=behavior", label: "行为", icon: IconWrench },
  { id: "prompts", href: "/admin?tab=prompts", label: "提示词", icon: IconPencil },
  { id: "asks", href: "/admin?tab=asks", label: "问答", icon: IconMessage },
] as const;

function localMcpScriptPath() {
  const script = path.join(process.cwd(), "mcp", "server.ts");
  const pkg = path.join(process.cwd(), "package.json");
  return existsSync(script) && existsSync(pkg) ? script : null;
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; range?: string; project?: string; compose?: string; run?: string; opt?: string }>;
}) {
  const identity = await requireAdminUser();
  const sp = await searchParams;
  const tab =
    sp.tab === "users" ||
    sp.tab === "keys" ||
    sp.tab === "prompts" ||
    sp.tab === "wake" ||
    sp.tab === "behavior" ||
    sp.tab === "asks"
      ? sp.tab
      : "analytics";
  const projects = tab === "wake" || tab === "behavior" ? listProjects(identity) : [];
  const requestedProject = Number(sp.project);
  const wakeProject = projects.find((project) => project.id === requestedProject) ?? null;
  const wakeOverviews = tab === "wake" ? listDispatchOverviews(identity) : [];
  const wakeRuntime = tab === "wake" ? dispatchRuntimeStatus() : null;
  const behaviorOverviews = tab === "behavior" ? listBehaviorOverviews(identity) : [];

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

      {tab === "asks" ? (
        <AsksAdmin
          runs={listAskAdminRecords(identity).map((run) => ({ ...run, answer: "", error: "" }))}
          selected={sp.opt ? null : readAskAdminRecord(identity, Number(sp.run) || 0)}
          optimizations={listAskOptimizations(identity)}
          selectedOptimization={sp.opt ? readAskOptimization(identity, Number(sp.opt) || 0) : null}
          queue={askOptimizeQueue(identity)}
        />
      ) : null}

      {tab === "behavior" ? (
        <BehaviorAdmin
          projects={projects.map((project) => ({ id: project.id, name: project.name }))}
          overviews={behaviorOverviews.map((item) => ({
            projectId: item.projectId,
            projectName: item.projectName,
            highlights: item.highlights,
          }))}
          editor={
            wakeProject
              ? {
                  mode: "edit",
                  project: { id: wakeProject.id, name: wakeProject.name },
                  initial: getBehaviorSettings(identity, wakeProject.id),
                }
              : null
          }
        />
      ) : null}

      {tab === "wake" && wakeRuntime ? (
        <DispatchAdmin
          projects={projects.map((project) => ({
            id: project.id,
            name: project.name,
            repoUrl: project.github_url || "",
          }))}
          overviews={wakeOverviews}
          runtime={wakeRuntime}
          editor={
            wakeProject
              ? {
                  mode: "edit",
                  project: {
                    id: wakeProject.id,
                    name: wakeProject.name,
                    repoUrl: wakeProject.github_url || "",
                  },
                  initial: getDispatchSettings(identity, wakeProject.id),
                }
              : sp.compose === "new"
                ? { mode: "create" }
                : null
          }
        />
      ) : null}
    </AppShell>
  );
}
