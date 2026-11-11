"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  DispatchOverview,
  DispatchRecent,
  DispatchRuntimeStatus,
  DispatchSettings,
  LocalAgentKind,
} from "@/lib/dispatch";
import { formatDateTimeShort } from "@/lib/time";

const REASON_LABEL: Record<string, string> = {
  created: "新建",
  provide_info: "补充材料",
  reject_fix: "打回",
  dispute_invalid: "异议",
  reopen_invalid: "撤回不属实",
  manual: "手动",
  test: "测试",
  organize: "整理走查",
};

const TARGET_LABEL: Record<string, string> = {
  webhook: "本机",
  cursor: "云端",
};

const KIND_LABEL: Record<LocalAgentKind, string> = {
  cursor: "本机 Cursor",
  zcode: "ZCode",
  command: "自定义命令",
};

type ProjectOption = { id: number; name: string; repoUrl: string };

type AgentDraft = {
  key: string;
  name: string;
  kind: LocalAgentKind;
  command: string;
  enabled: boolean;
};

type EditorState =
  | { mode: "create" }
  | { mode: "edit"; project: ProjectOption; initial: DispatchSettings }
  | null;

function agentDrafts(settings: DispatchSettings): AgentDraft[] {
  return settings.localAgents.map((item, index) => ({
    key: `${item.id}-${index}`,
    name: item.name,
    kind: item.kind,
    command: item.command,
    enabled: item.enabled,
  }));
}

function blankAgents(): AgentDraft[] {
  return [{ key: "default-cursor", name: "本机 Cursor", kind: "cursor", command: "", enabled: true }];
}

const STATUS_LABEL: Record<DispatchRecent["status"], string> = {
  pending: "发送中",
  sent: "已送达",
  failed: "失败",
  skipped: "未发送",
};

function explainDetail(detail: string) {
  if (detail === "fetch failed") return "连不上这个地址";
  if (detail === "没有可启动的本机 agent") return "本机收到了，但没有可启动的 Agent";
  return detail;
}

function resultText(item: DispatchRecent) {
  const when = formatDateTimeShort(item.createdAt);
  if (item.reason === "test") {
    if (item.status === "failed") {
      return { head: `${when} · 测试本机地址：没送到`, href: "", extra: explainDetail(item.detail) };
    }
    if (item.status === "pending") {
      return { head: `${when} · 测试本机地址：正在发送`, href: "", extra: "" };
    }
    return {
      head: `${when} · 测试本机地址：已通`,
      href: "",
      extra: "只说明地址和签名对上了，没有启动 Agent",
    };
  }
  const reason = REASON_LABEL[item.reason] || item.reason;
  const target = TARGET_LABEL[item.target] || item.target;
  const head = `${when} · ${reason} · ${target} · ${STATUS_LABEL[item.status]}`;
  if (item.status === "sent" && item.detail.startsWith("https://cursor.com/")) {
    return { head, href: item.detail, extra: "" };
  }
  if (item.status === "failed" || item.status === "skipped") {
    return { head, href: "", extra: explainDetail(item.detail) };
  }
  return { head, href: "", extra: "" };
}

function repairLabel(item: DispatchOverview) {
  const parts = [
    item.repairLocalEnabled ? "本机 Agent" : "",
    item.cursorEnabled ? "云端 Agent" : "",
  ].filter(Boolean);
  return parts.length ? parts.join("、") : "未启用";
}

function localDetail(item: DispatchOverview) {
  if (!item.webhookUrl) return "未配置";
  if (!item.agentsSaved) return "名单未保存在这里，由 wake 配置里的 agent 接手";
  const enabled = item.agents.filter((agent) => agent.enabled).map((agent) => agent.name);
  return enabled.length ? enabled.join("、") : "没有启用的 Agent";
}

export function DispatchAdmin({
  projects,
  overviews,
  runtime,
  editor,
}: {
  projects: ProjectOption[];
  overviews: DispatchOverview[];
  runtime: DispatchRuntimeStatus;
  editor: EditorState;
}) {
  const router = useRouter();
  const configured = new Set(overviews.map((item) => item.projectId));
  const available = projects.filter((project) => !configured.has(project.id));

  if (editor?.mode === "edit") {
    return (
      <DispatchEditor
        key={editor.project.id}
        mode="edit"
        project={editor.project}
        initial={editor.initial}
        runtime={runtime}
      />
    );
  }
  if (editor?.mode === "create") {
    return <DispatchEditor mode="create" projects={available} initial={null} runtime={runtime} />;
  }

  return (
    <DispatchList
      overviews={overviews}
      canCreate={available.length > 0}
      createReason={projects.length === 0 ? "还没有项目。先建一个项目，再来新建分派。" : "每个项目已经有一套配置。要修改，用这一行的编辑。"}
      onCreate={() => router.push("/admin?tab=wake&compose=new")}
    />
  );
}

function DispatchList({
  overviews,
  canCreate,
  createReason,
  onCreate,
}: {
  overviews: DispatchOverview[];
  canCreate: boolean;
  createReason: string;
  onCreate: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  async function testRow(item: DispatchOverview) {
    setBusyId(item.projectId);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/projects/${item.projectId}/dispatch`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || "测试失败");
        return;
      }
      setNotice(
        `已向「${item.projectName}」的本机地址发出检查。大约一秒后，项目名下面会更新：写成「本机地址已通」就是通了，写成「没送到」才是没通。这次不启动 Agent。`
      );
      window.setTimeout(() => router.refresh(), 1200);
    } finally {
      setBusyId(null);
    }
  }

  async function removeRow(item: DispatchOverview) {
    if (
      !window.confirm(
        `确定删除「${item.projectName}」的配置？之后这个项目的报障不再自动分派给 Agent。已有的分派记录会保留。`
      )
    ) {
      return;
    }
    setBusyId(item.projectId);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/projects/${item.projectId}/dispatch`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || "删除失败");
        return;
      }
      setNotice(`已删除「${item.projectName}」的配置`);
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="bb-card bb-section-card bb-dispatch">
      <div className="bb-dispatch-head">
        <div>
          <h2>分派给 Agent</h2>
          <p className="bb-muted bb-dispatch-lead">
            每个项目一套。整理走查只发给本机 Agent。修理报障可以发给本机 Agent、Cursor 云端 Agent，或两个都发。绿色字是已经保存的开关。
          </p>
          <p className="bb-muted bb-dispatch-lead">
            「测试地址」只检查本机地址和签名能不能对上，不启动 Agent，也不测云端。结果在项目名下面：写成「本机地址已通」就是通了，写成「没送到」才是没通。会不会拉起 Agent，要等一次真实的整理走查或修理报障，结果写成「已送达」才算拉起。
          </p>
          {!canCreate ? <p className="bb-dispatch-reason">{createReason}</p> : null}
        </div>
        <button
          type="button"
          className="bb-btn"
          onClick={onCreate}
          disabled={!canCreate}
          title={canCreate ? undefined : createReason}
        >
          新建分派
        </button>
      </div>
      {error ? <p className="bb-error">{error}</p> : null}
      {notice ? <p className="bb-dispatch-note">{notice}</p> : null}
      {overviews.length === 0 ? (
        <p className="bb-muted bb-dispatch-empty">
          还没有配置。新建后，可以分别决定要不要整理走查、要不要修理报障。
        </p>
      ) : (
        <div className="bb-table-wrap">
          <table className="bb-table">
            <thead>
              <tr>
                <th scope="col">项目</th>
                <th scope="col">整理走查</th>
                <th scope="col">修理报障</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {overviews.map((item) => {
                const latest = item.latest ? resultText(item.latest) : null;
                const busy = busyId === item.projectId;
                return (
                  <tr key={item.projectId}>
                    <td>
                      <span className="bb-dispatch-project">{item.projectName}</span>
                      {item.webhookUrl ? (
                        <span className="bb-dispatch-url" title={item.webhookUrl}>
                          {item.webhookUrl}
                        </span>
                      ) : null}
                      {latest ? (
                        <span className="bb-dispatch-sub">
                          最近一次结果：{latest.head}
                          {latest.extra ? `。${latest.extra}` : ""}
                        </span>
                      ) : (
                        <span className="bb-dispatch-sub">还没有结果。点「测试地址」检查本机地址通不通。</span>
                      )}
                    </td>
                    <td>
                      <span className="bb-dispatch-k">整理走查</span>
                      <span className={item.organizeEnabled ? "bb-dispatch-status is-on" : "bb-dispatch-status"}>
                        {item.organizeEnabled ? "本机 Agent" : "未启用"}
                      </span>
                      {item.organizeEnabled ? <span className="bb-dispatch-sub">{localDetail(item)}</span> : null}
                    </td>
                    <td>
                      <span className="bb-dispatch-k">修理报障</span>
                      <span
                        className={
                          item.repairLocalEnabled || item.cursorEnabled
                            ? "bb-dispatch-status is-on"
                            : "bb-dispatch-status"
                        }
                      >
                        {repairLabel(item)}
                      </span>
                    </td>
                    <td>
                      <div className="bb-cell-actions">
                        <button
                          type="button"
                          className="bb-btn bb-btn-secondary"
                          onClick={() => router.push(`/admin?tab=wake&project=${item.projectId}`)}
                          disabled={busy}
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          className="bb-btn bb-btn-secondary"
                          onClick={() => testRow(item)}
                          disabled={busy || !item.webhookUrl}
                          title={
                            item.webhookUrl
                              ? "只检查本机地址和签名，不启动 Agent，也不测云端"
                              : "还没有本机地址，无法测试"
                          }
                        >
                          {busy ? "处理中…" : "测试地址"}
                        </button>
                        <button
                          type="button"
                          className="bb-btn bb-btn-ghost"
                          onClick={() => removeRow(item)}
                          disabled={busy}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DispatchEditor({
  mode,
  project,
  projects = [],
  initial,
  runtime,
}: {
  mode: "create" | "edit";
  project?: ProjectOption;
  projects?: ProjectOption[];
  initial: DispatchSettings | null;
  runtime: DispatchRuntimeStatus;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(mode === "edit" ? project?.id ?? 0 : projects.length === 1 ? projects[0].id : 0);
  const [webhookUrl, setWebhookUrl] = useState(initial?.webhookUrl ?? "");
  const [organizeEnabled, setOrganizeEnabled] = useState(initial?.organizeEnabled ?? true);
  const [repairLocalEnabled, setRepairLocalEnabled] = useState(initial?.repairLocalEnabled ?? true);
  const [cursorEnabled, setCursorEnabled] = useState(initial?.cursorEnabled ?? false);
  const [agents, setAgents] = useState<AgentDraft[]>(() => (initial ? agentDrafts(initial) : blankAgents()));
  const [settings, setSettings] = useState<DispatchSettings | null>(initial);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState<"save" | "rotate" | "test" | "">("");
  const recentKey = initial?.recent.map((item) => `${item.id}:${item.status}:${item.detail}`).join("|") ?? "";

  useEffect(() => {
    if (!initial) return;
    setSettings((prev) => (prev ? { ...prev, recent: initial.recent } : initial));
  }, [initial, recentKey]);

  const selected = mode === "edit" ? project : projects.find((item) => item.id === selectedId);
  const repoUrl = selected?.repoUrl ?? "";
  const cursorKeyConfigured = settings?.cursorKeyConfigured ?? runtime.cursorKeyConfigured;
  const dispatchKeyConfigured = settings?.dispatchKeyConfigured ?? runtime.dispatchKeyConfigured;

  function backToList() {
    router.push("/admin?tab=wake");
  }

  async function persist(rotateSecret: boolean) {
    if (!selected) {
      setError("先选择项目");
      return;
    }
    if ((organizeEnabled || repairLocalEnabled) && !webhookUrl.trim()) {
      setError("发给本机 Agent 时，先填本机地址");
      return;
    }
    if (!organizeEnabled && !repairLocalEnabled && !cursorEnabled) {
      setError("至少启用一件活：整理走查，或修理报障");
      return;
    }
    setLoading(rotateSecret ? "rotate" : "save");
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/projects/${selected.id}/dispatch`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhookUrl,
          organizeEnabled,
          repairLocalEnabled,
          cursorEnabled,
          rotateSecret,
          localAgents: agents.map((item) => ({
            name: item.name,
            kind: item.kind,
            command: item.command,
            enabled: item.enabled,
          })),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        settings?: DispatchSettings;
      };
      if (!res.ok || !data.settings) {
        setError(data.error || "保存失败");
        return;
      }
      setSettings(data.settings);
      setWebhookUrl(data.settings.webhookUrl);
      setOrganizeEnabled(data.settings.organizeEnabled);
      setRepairLocalEnabled(data.settings.repairLocalEnabled);
      setCursorEnabled(data.settings.cursorEnabled);
      setAgents(agentDrafts(data.settings));
      setNotice(rotateSecret ? "已更换签名密钥，旧密钥立即失效" : "已保存");
      if (mode === "create") {
        router.replace(`/admin?tab=wake&project=${selected.id}`);
      }
      router.refresh();
    } finally {
      setLoading("");
    }
  }

  async function testWake() {
    if (!selected) return;
    setLoading("test");
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/projects/${selected.id}/dispatch`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || "测试失败");
        return;
      }
      setNotice(
        "已向已保存的本机地址发出检查。大约一秒后，下面的记录会更新：写成「本机地址已通」就是通了。这次不启动 Agent，也不测云端。"
      );
      window.setTimeout(() => router.refresh(), 1200);
    } finally {
      setLoading("");
    }
  }

  async function copySecret() {
    if (!settings?.webhookSecret) return;
    try {
      await navigator.clipboard.writeText(settings.webhookSecret);
      setNotice("签名密钥已复制");
      setError("");
    } catch {
      setError("复制失败，请手动选择密钥");
    }
  }

  function updateAgent(key: string, partial: Partial<AgentDraft>) {
    setAgents((prev) => prev.map((item) => (item.key === key ? { ...item, ...partial } : item)));
  }

  function addAgent(kind: LocalAgentKind) {
    if (agents.length >= 8) {
      setError("本机 Agent 最多 8 个");
      return;
    }
    const name = kind === "cursor" ? "本机 Cursor" : kind === "zcode" ? "ZCode" : "自定义命令";
    setAgents((prev) => [
      ...prev,
      { key: `new-${kind}-${prev.length}-${Date.now()}`, name, kind, command: "", enabled: true },
    ]);
    setError("");
  }

  function moveAgent(index: number, delta: number) {
    setAgents((prev) => {
      const next = prev.slice();
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  }

  const cursorHint = !selected
    ? "先选择项目。云端 Agent 还需要该项目资料里的代码仓。"
    : !cursorKeyConfigured
      ? "当前服务器还没设置 CURSOR_API_KEY。启用后，云端 Agent 会跳过，直到配上这把密钥。"
      : !repoUrl
        ? "这个项目的资料里还没有代码仓。启用后，云端 Agent 会跳过，直到补上代码仓。"
        : dispatchKeyConfigured
          ? "云端 Agent 会带上 Bugboard MCP。Bugboard 必须能从云端访问，状态才会被回写。"
          : "云端能访问这个 Bugboard 时才会回写状态。访问不了时，它仍按报障改代码。";

  return (
    <section className="bb-card bb-section-card bb-dispatch">
      <div className="bb-dispatch-head">
        <div>
          <h2>{mode === "create" ? "新建分派" : "编辑分派"}</h2>
          <p className="bb-muted bb-dispatch-lead">
            {mode === "edit" && project ? `项目：${project.name}。` : "选一个还没有配置的项目。"}
            整理走查和修理报障是两件活，分开开关。本机地址两件活共用；Cursor 云端 Agent 只修理报障。
          </p>
        </div>
        <button type="button" className="bb-btn bb-btn-secondary" onClick={backToList}>
          返回清单
        </button>
      </div>

      {mode === "create" ? (
        projects.length === 0 ? (
          <p className="bb-muted">每个项目已经有一套配置。要修改，请从清单进入编辑。</p>
        ) : (
          <div className="bb-field">
            <label className="bb-label" htmlFor="bb-dispatch-project">
              项目
            </label>
            <select
              id="bb-dispatch-project"
              className="bb-select"
              value={selectedId || ""}
              onChange={(event) => setSelectedId(Number(event.target.value))}
            >
              <option value="">选择项目</option>
              {projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
        )
      ) : null}

      <fieldset className="bb-dispatch-channel" disabled={mode === "create" && projects.length === 0}>
        <legend>整理走查</legend>
        <label className="bb-checkline bb-dispatch-job">
          <input
            type="checkbox"
            checked={organizeEnabled}
            onChange={(event) => setOrganizeEnabled(event.target.checked)}
          />
          走查录完后，分派给本机 Agent 整理
        </label>
        <div className="bb-dispatch-guide">
          <p>走查进入审核时触发。只重写草稿，不创建报障，不改代码。云端 Agent 不参与。</p>
        </div>
      </fieldset>

      <fieldset className="bb-dispatch-channel" disabled={mode === "create" && projects.length === 0}>
        <legend>修理报障</legend>
        <label className="bb-checkline bb-dispatch-job">
          <input
            type="checkbox"
            checked={repairLocalEnabled}
            onChange={(event) => setRepairLocalEnabled(event.target.checked)}
          />
          分派给本机 Agent 修理
        </label>
        <label className="bb-checkline bb-dispatch-job">
          <input
            type="checkbox"
            checked={cursorEnabled}
            onChange={(event) => setCursorEnabled(event.target.checked)}
          />
          分派给 Cursor 云端 Agent 修理
        </label>
        <div className="bb-dispatch-guide">
          <p>进入待处理时触发。确认已修复和接单不会分派。两处都开时，同一张报障各发一次。</p>
        </div>
        <p className="bb-field-hint">{cursorHint}</p>
      </fieldset>

      <fieldset className="bb-dispatch-channel" disabled={mode === "create" && projects.length === 0}>
        <legend>本机 Agent</legend>
        <div className="bb-dispatch-guide">
          <p>
            整理或修理勾了本机，才用这个地址。处理电脑上执行 <code>npm run wake</code>
            ，按名单从上到下尝试。两件活的提示词不同。
          </p>
          <p>
            {organizeEnabled || repairLocalEnabled
              ? "当前勾选的本机活会发到这个地址。"
              : "两件活都没发给本机时，地址可以留空。"}
          </p>
        </div>
        <div className="bb-field">
          <label className="bb-label" htmlFor="bb-dispatch-url">
            本机地址
          </label>
          <input
            id="bb-dispatch-url"
            className="bb-input"
            value={webhookUrl}
            onChange={(event) => setWebhookUrl(event.target.value)}
            placeholder="http://127.0.0.1:3099/wake"
            spellCheck={false}
          />
          <p className="bb-field-hint">
            在处理电脑上执行 <code>npm run wake</code>
            ，把打印出来的地址填在这里。Bugboard 在 Docker 里时，填容器能访问宿主机的地址，例如{" "}
            <code>http://host.docker.internal:3099/wake</code>。
          </p>
        </div>
        <div className="bb-field">
          <span className="bb-label">签名密钥</span>
          <div className="bb-dispatch-secret">
            <input
              className="bb-input"
              readOnly
              value={settings?.webhookSecret || "保存后生成"}
              aria-label="签名密钥"
              spellCheck={false}
            />
            <button
              type="button"
              className="bb-btn bb-btn-secondary"
              onClick={copySecret}
              disabled={!settings?.webhookSecret}
            >
              复制
            </button>
            <button
              type="button"
              className="bb-btn bb-btn-secondary"
              onClick={() => persist(true)}
              disabled={loading !== "" || !selected}
            >
              {loading === "rotate" ? "更换中…" : "更换密钥"}
            </button>
          </div>
          <p className="bb-field-hint">
            把同一串填进 wake 配置的 <code>secrets</code>，然后重启 <code>npm run wake</code>
            。更换后旧密钥立即失效。
          </p>
        </div>
        <div className="bb-field">
          <span className="bb-label">本机 Agent</span>
          <p className="bb-field-hint">
            按从上到下的顺序尝试。还没保存过这份名单时，由 wake 配置里的 Agent 接手，默认是 Cursor。
          </p>
          <ul className="bb-agent-list">
            {agents.map((item, index) => (
              <li key={item.key} className="bb-agent-row">
                <label className="bb-checkline">
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    onChange={(event) => updateAgent(item.key, { enabled: event.target.checked })}
                    aria-label={`${item.name} 启用`}
                  />
                </label>
                <input
                  className="bb-input"
                  value={item.name}
                  aria-label="agent 名称"
                  onChange={(event) => updateAgent(item.key, { name: event.target.value })}
                />
                <select
                  className="bb-select"
                  aria-label="agent 类型"
                  value={item.kind}
                  onChange={(event) =>
                    updateAgent(item.key, {
                      kind: event.target.value as LocalAgentKind,
                      command: event.target.value === "command" ? item.command : "",
                    })
                  }
                >
                  {(Object.keys(KIND_LABEL) as LocalAgentKind[]).map((kind) => (
                    <option key={kind} value={kind}>
                      {KIND_LABEL[kind]}
                    </option>
                  ))}
                </select>
                {item.kind === "command" ? (
                  <input
                    className="bb-input"
                    value={item.command}
                    aria-label="启动命令"
                    placeholder="命令名，例如 my-agent"
                    spellCheck={false}
                    onChange={(event) => updateAgent(item.key, { command: event.target.value })}
                  />
                ) : null}
                <div className="bb-agent-moves">
                  <button
                    type="button"
                    className="bb-btn bb-btn-ghost"
                    onClick={() => moveAgent(index, -1)}
                    disabled={index === 0}
                  >
                    上移
                  </button>
                  <button
                    type="button"
                    className="bb-btn bb-btn-ghost"
                    onClick={() => moveAgent(index, 1)}
                    disabled={index === agents.length - 1}
                  >
                    下移
                  </button>
                  <button
                    type="button"
                    className="bb-btn bb-btn-ghost"
                    onClick={() => setAgents((prev) => prev.filter((agent) => agent.key !== item.key))}
                  >
                    移除
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <div className="bb-dispatch-actions">
            <button type="button" className="bb-btn bb-btn-secondary" onClick={() => addAgent("cursor")}>
              添加本机 Cursor
            </button>
            <button type="button" className="bb-btn bb-btn-secondary" onClick={() => addAgent("zcode")}>
              添加 ZCode
            </button>
            <button type="button" className="bb-btn bb-btn-secondary" onClick={() => addAgent("command")}>
              添加自定义命令
            </button>
          </div>
        </div>
      </fieldset>

      {error ? <p className="bb-error">{error}</p> : null}
      {notice ? <p className="bb-dispatch-note">{notice}</p> : null}
      <div className="bb-dispatch-actions">
        <button type="button" className="bb-btn" onClick={() => persist(false)} disabled={loading !== "" || !selected}>
          {loading === "save" ? "保存中…" : "保存"}
        </button>
        <button
          type="button"
          className="bb-btn bb-btn-secondary"
          onClick={testWake}
          disabled={
            loading !== "" || !settings?.webhookUrl || webhookUrl.trim() !== settings.webhookUrl || !selected
          }
          title="只检查已保存的本机地址和签名。不启动 Agent，也不测云端。改过地址要先保存。"
        >
          {loading === "test" ? "发送中…" : "测试本机地址"}
        </button>
      </div>
      <p className="bb-field-hint">
        先保存，再测。测试用的是已保存的本机地址和签名。写成「本机地址已通」就是通了。这次不启动 Agent，也不测云端。会不会拉起 Agent，要看真实整理或修理的结果是否写成「已送达」。
      </p>
      {settings && settings.recent.length > 0 ? (
        <ul className="bb-dispatch-log">
          {settings.recent.map((item) => {
            const text = resultText(item);
            return (
              <li key={item.id}>
                <span>
                  {item.publicId ? `${item.publicId} · ` : ""}
                  {text.head}
                </span>
                {text.href ? (
                  <a href={text.href} target="_blank" rel="noreferrer">
                    打开
                  </a>
                ) : null}
                {text.extra ? <span className="bb-muted">{text.extra}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

export function WakeBugButton({
  bugId,
  canWake,
  initial,
}: {
  bugId: number;
  canWake: boolean;
  initial: DispatchRecent | null;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const latest = initial ? resultText(initial) : null;

  async function wake() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/bugs/${bugId}/wake`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || "没能分派去修理");
        return;
      }
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bb-wake">
      {latest ? (
        <p className="bb-muted">
          最近一次：{latest.head}
          {latest.href ? (
            <>
              {" "}
              <a href={latest.href} target="_blank" rel="noreferrer">
                打开
              </a>
            </>
          ) : null}
          {latest.extra ? `。${latest.extra}` : ""}
        </p>
      ) : (
        <p className="bb-muted">这张报障还没有分派去修理。</p>
      )}
      {canWake ? (
        <button type="button" className="bb-btn bb-btn-secondary" onClick={wake} disabled={loading}>
          {loading ? "发送中…" : latest ? "再次分派去修理" : "分派去修理"}
        </button>
      ) : null}
      {error ? <p className="bb-error">{error}</p> : null}
    </div>
  );
}
