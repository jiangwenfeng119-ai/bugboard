"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { DispatchRecent, DispatchSettings, LocalAgentKind } from "@/lib/dispatch";
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
  cursor: "Cursor",
};

const KIND_LABEL: Record<LocalAgentKind, string> = {
  cursor: "本机 Cursor",
  zcode: "ZCode",
  command: "自定义命令",
};

type AgentDraft = {
  key: string;
  name: string;
  kind: LocalAgentKind;
  command: string;
  enabled: boolean;
};

function agentDrafts(settings: DispatchSettings): AgentDraft[] {
  return settings.localAgents.map((item, index) => ({
    key: `${item.id}-${index}`,
    name: item.name,
    kind: item.kind,
    command: item.command,
    enabled: item.enabled,
  }));
}

const STATUS_LABEL: Record<DispatchRecent["status"], string> = {
  pending: "发送中",
  sent: "已送达",
  failed: "失败",
  skipped: "未发送",
};

function resultText(item: DispatchRecent) {
  const reason = REASON_LABEL[item.reason] || item.reason;
  const target = TARGET_LABEL[item.target] || item.target;
  const when = formatDateTimeShort(item.createdAt);
  const head = `${when} · ${reason} · ${target} · ${STATUS_LABEL[item.status]}`;
  if (item.status === "sent" && item.detail.startsWith("https://cursor.com/")) {
    return { head, href: item.detail, extra: "" };
  }
  if (item.status === "failed" || item.status === "skipped") {
    return { head, href: "", extra: item.detail };
  }
  return { head, href: "", extra: "" };
}

export function DispatchPanel({
  projectId,
  initial,
  projects,
}: {
  projectId: number;
  initial: DispatchSettings;
  projects?: { id: number; name: string }[];
}) {
  const router = useRouter();
  const [settings, setSettings] = useState(initial);
  const [webhookUrl, setWebhookUrl] = useState(initial.webhookUrl);
  const [cursorEnabled, setCursorEnabled] = useState(initial.cursorEnabled);
  const [agents, setAgents] = useState<AgentDraft[]>(() => agentDrafts(initial));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState<"save" | "rotate" | "test" | "">("");

  useEffect(() => {
    setSettings(initial);
  }, [initial]);

  async function persist(rotateSecret: boolean) {
    setLoading(rotateSecret ? "rotate" : "save");
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/projects/${projectId}/dispatch`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhookUrl,
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
      setCursorEnabled(data.settings.cursorEnabled);
      setAgents(agentDrafts(data.settings));
      setNotice(rotateSecret ? "已换新密钥" : "已保存");
      router.refresh();
    } finally {
      setLoading("");
    }
  }

  async function testWake() {
    setLoading("test");
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/projects/${projectId}/dispatch`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || "测试失败");
        return;
      }
      setNotice("已向叫醒地址发了测试，几秒后刷新可以看到结果");
      window.setTimeout(() => router.refresh(), 1200);
    } finally {
      setLoading("");
    }
  }

  async function copySecret() {
    if (!settings.webhookSecret) return;
    try {
      await navigator.clipboard.writeText(settings.webhookSecret);
      setNotice("密钥已复制");
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
      setError("本机 agent 最多 8 个");
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

  const cursorHint = !settings.cursorKeyConfigured
    ? "当前服务器还没设置 CURSOR_API_KEY。"
    : !settings.repoUrl
      ? "项目资料里还没有代码仓。"
      : settings.dispatchKeyConfigured
        ? "云端 Agent 会带上 Bugboard MCP。Bugboard 必须能从云端访问，单才会被回写。"
        : "云端能访问这个 Bugboard 时才会回写状态。访问不了时，它仍按报障改代码。";

  return (
    <section className="bb-card bb-section-card bb-dispatch">
      <h2>叫醒处理端</h2>
        <p className="bb-muted bb-dispatch-lead">
        待处理的报障，和刚录完的走查，会分别叫醒下面的本机 agent。整理走查只写草稿，不改代码。人在走查页确认后，留下的才进入待处理。
      </p>
      {projects && projects.length > 1 ? (
        <div className="bb-field">
          <label className="bb-label" htmlFor="bb-dispatch-project">
            项目
          </label>
          <select
            id="bb-dispatch-project"
            className="bb-select"
            value={projectId}
            onChange={(event) => {
              router.push(`/admin?tab=wake&project=${event.target.value}`);
            }}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
      ) : projects?.length === 1 ? (
        <p className="bb-field-hint">项目：{projects[0].name}</p>
      ) : null}
      <div className="bb-field">
        <label className="bb-label" htmlFor="bb-dispatch-url">
          叫醒地址
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
          在跑 Agent 的电脑上执行 <code>npm run wake</code>
          ，把打印出来的地址填进来。Bugboard 在 Docker 里时，用容器能访问宿主机的地址，例如{" "}
          <code>http://host.docker.internal:3099/wake</code>。
        </p>
      </div>
      <div className="bb-field">
        <span className="bb-label">密钥</span>
        <div className="bb-dispatch-secret">
          <input
            className="bb-input"
            readOnly
            value={settings.webhookSecret || "保存后生成"}
            aria-label="叫醒密钥"
            spellCheck={false}
          />
          <button
            type="button"
            className="bb-btn bb-btn-secondary"
            onClick={copySecret}
            disabled={!settings.webhookSecret}
          >
            复制
          </button>
          <button
            type="button"
            className="bb-btn bb-btn-secondary"
            onClick={() => persist(true)}
            disabled={loading !== ""}
          >
            {loading === "rotate" ? "更换中…" : "换一把"}
          </button>
        </div>
        <p className="bb-field-hint">wake 配置里的 secrets 填同一串。换一把之后，旧密钥立刻失效。</p>
      </div>
      <div className="bb-field">
        <span className="bb-label">本机 agent</span>
        <p className="bb-field-hint">
          按顺序试。前一个拉不起来，才试下一个。处理待处理和整理走查用同一份名单，提示词不同。还没保存过这份名单时，本机 wake 配置里的 agent 会接，默认是 Cursor。
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
              <button type="button" className="bb-btn bb-btn-ghost" onClick={() => moveAgent(index, -1)} disabled={index === 0}>
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
      <label className="bb-checkline bb-dispatch-cursor">
        <input
          type="checkbox"
          checked={cursorEnabled}
          onChange={(event) => setCursorEnabled(event.target.checked)}
        />
        同时启动 Cursor 云端 Agent，只处理待处理报障
      </label>
      <p className="bb-field-hint">{cursorHint}</p>
      {error ? <p className="bb-error">{error}</p> : null}
      {notice ? <p className="bb-muted">{notice}</p> : null}
      <div className="bb-dispatch-actions">
        <button
          type="button"
          className="bb-btn"
          onClick={() => persist(false)}
          disabled={loading !== ""}
        >
          {loading === "save" ? "保存中…" : "保存"}
        </button>
        <button
          type="button"
          className="bb-btn bb-btn-secondary"
          onClick={testWake}
          disabled={
            loading !== "" || !settings.webhookUrl || webhookUrl.trim() !== settings.webhookUrl
          }
        >
          {loading === "test" ? "发送中…" : "测试地址"}
        </button>
      </div>
      {settings.recent.length > 0 ? (
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
        setError(data.error || "叫醒失败");
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
          上次叫醒：{latest.head}
          {latest.href ? (
            <>
              {" "}
              <a href={latest.href} target="_blank" rel="noreferrer">
                打开
              </a>
            </>
          ) : null}
          {latest.extra ? ` · ${latest.extra}` : ""}
        </p>
      ) : (
        <p className="bb-muted">这张单还没叫醒过。</p>
      )}
      {canWake ? (
        <button type="button" className="bb-btn bb-btn-secondary" onClick={wake} disabled={loading}>
          {loading ? "发送中…" : "再叫一次"}
        </button>
      ) : null}
      {error ? <p className="bb-error">{error}</p> : null}
    </div>
  );
}
