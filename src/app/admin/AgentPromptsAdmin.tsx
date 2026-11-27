"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconClock, IconPencil, IconSearch, IconWrench } from "@/components/Icons";
import {
  ADMIN_AGENT_PROMPT,
  RELEASE_AGENT_PROMPT,
  USER_AGENT_PROMPT,
  applyProjectName,
} from "@/lib/agent-prompts";
import {
  AGENT_PROMPT_REVISIONS,
  type AgentPromptId,
  type AgentPromptRevision,
} from "@/lib/agent-prompt-history";
import { formatDateTime } from "@/lib/time";

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.top = "0";
      area.style.left = "0";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.focus();
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

const PROMPTS: {
  id: AgentPromptId;
  title: string;
  summary: string;
  icon: typeof IconSearch;
  text: string;
}[] = [
  {
    id: "user",
    title: "用户级 · 测试与验收",
    summary: "检查指定项目，把缺陷提单，并对待确认的修复做验收、打回或异议。",
    icon: IconSearch,
    text: USER_AGENT_PROMPT,
  },
  {
    id: "admin",
    title: "管理员级 · 查看并修复",
    summary: "故障就修好。没用对或配置不对标不属实。还没有的新能力要等产品经理在系统里点可以做或不做。",
    icon: IconWrench,
    text: ADMIN_AGENT_PROMPT,
  },
  {
    id: "release",
    title: "发布 · 夜间复核",
    summary: "每天复核待发布，能单独撤回的退回待处理，通过的才发布并做健康检查。",
    icon: IconClock,
    text: RELEASE_AGENT_PROMPT,
  },
];

export function AgentPromptsAdmin() {
  const [projectName, setProjectName] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [historyId, setHistoryId] = useState<AgentPromptId | null>(null);
  const [historyVersion, setHistoryVersion] = useState<number | null>(null);
  const copiedTimer = useRef<number | null>(null);

  async function copyPrompt(key: string, text: string) {
    const ok = await writeClipboard(applyProjectName(text, projectName));
    if (!ok) {
      setError("复制失败，请允许剪贴板权限后重试");
      return;
    }
    setError("");
    setCopiedKey(key);
    if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopiedKey(null), 2000);
  }

  const historyPrompt = PROMPTS.find((item) => item.id === historyId) ?? null;

  return (
    <>
      <section className="bb-card bb-section-card">
        <h2 className="bb-title-with-icon">
          <span className="bb-title-icon" aria-hidden>
            <IconPencil size={16} />
          </span>
          给 Agent 的提示词
        </h2>
        <p className="bb-muted bb-prompt-lead">
          「API Key」页点「复制给 Agent」，再选本机或远端，把 MCP 配进客户端。这里是配好之后的工作说明，按角色整段复制。
          先填写目标项目，复制时会写进提示词；留空则保留待填的那一行，贴到对话里再补。每段标出当前版本和更新时间。点「查看历史」看最近 5 版，以及这一版改了什么。
        </p>
        <label className="bb-field">
          <span className="bb-label">目标项目</span>
          <input
            className="bb-input bb-input-compact"
            value={projectName}
            placeholder="例如 官网"
            onChange={(e) => setProjectName(e.target.value)}
          />
        </label>
        {error ? <p className="bb-error">{error}</p> : null}
      </section>

      <div className="bb-prompt-grid">
      {PROMPTS.map((item) => {
        const Icon = item.icon;
        const current = AGENT_PROMPT_REVISIONS[item.id][0];
        const text = applyProjectName(item.text, projectName);
        return (
          <section key={item.id} className="bb-card bb-section-card">
            <div className="bb-prompt-head">
              <div>
                <h2 className="bb-title-with-icon">
                  <span className="bb-title-icon" aria-hidden>
                    <Icon size={16} />
                  </span>
                  {item.title}
                </h2>
                <p className="bb-muted bb-prompt-summary">{item.summary}</p>
                <p className="bb-prompt-version">
                  版本 {current.version}
                  <span aria-hidden> · </span>
                  <time dateTime={current.updatedAt}>更新于 {formatDateTime(current.updatedAt)}</time>
                </p>
              </div>
              <div className="bb-prompt-actions">
                <button
                  type="button"
                  className="bb-btn bb-btn-secondary"
                  aria-haspopup="dialog"
                  onClick={() => {
                    setHistoryId(item.id);
                    setHistoryVersion(current.version);
                  }}
                >
                  查看历史
                </button>
                <button type="button" className="bb-btn" onClick={() => copyPrompt(item.id, item.text)}>
                  {copiedKey === item.id ? "已复制" : "复制提示词"}
                </button>
              </div>
            </div>
            <pre className="bb-prompt-text">{text}</pre>
          </section>
        );
      })}
      </div>
      {historyPrompt && historyVersion != null ? (
        <PromptHistoryDialog
          title={historyPrompt.title}
          revisions={AGENT_PROMPT_REVISIONS[historyPrompt.id]}
          version={historyVersion}
          projectName={projectName}
          copiedKey={copiedKey}
          onSelect={setHistoryVersion}
          onCopy={copyPrompt}
          onClose={() => setHistoryId(null)}
        />
      ) : null}
    </>
  );
}

function PromptHistoryDialog({
  title,
  revisions,
  version,
  projectName,
  copiedKey,
  onSelect,
  onCopy,
  onClose,
}: {
  title: string;
  revisions: AgentPromptRevision[];
  version: number;
  projectName: string;
  copiedKey: string | null;
  onSelect: (version: number) => void;
  onCopy: (key: string, text: string) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const current = revisions[0];
  const selected = revisions.find((rev) => rev.version === version) ?? current;
  const copyKey = `history-${selected.version}`;

  useEffect(() => {
    document.body.classList.add("bb-modal-open");
    cardRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("bb-modal-open");
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return createPortal(
    <div className="bb-modal" role="presentation">
      <button type="button" className="bb-modal-backdrop" aria-label="关闭" onClick={onClose} />
      <div
        ref={cardRef}
        className="bb-modal-card bb-prompt-history-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="bb-sheet-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            <p>最近 5 版。点一条查看那一版全文，以及相对上一版改了什么。</p>
          </div>
          <button type="button" className="bb-btn bb-btn-ghost" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="bb-sheet-body">
          <ol className="bb-prompt-history">
            {revisions.map((rev) => {
              const selectedRow = rev.version === selected.version;
              return (
                <li key={rev.version}>
                  <button
                    type="button"
                    className={selectedRow ? "is-current" : undefined}
                    aria-pressed={selectedRow}
                    onClick={() => onSelect(rev.version)}
                  >
                    <span className="bb-prompt-history-meta">
                      版本 {rev.version}
                      {rev.version === current.version ? " · 当前" : ""}
                      <span aria-hidden> · </span>
                      <time dateTime={rev.updatedAt}>{formatDateTime(rev.updatedAt)}</time>
                    </span>
                    <span className="bb-prompt-history-changes">{rev.changes}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="bb-prompt-history-copy">
            <p className="bb-prompt-version">
              版本 {selected.version}
              {selected.version === current.version ? " · 当前" : ""}
              <span aria-hidden> · </span>
              <time dateTime={selected.updatedAt}>更新于 {formatDateTime(selected.updatedAt)}</time>
            </p>
            <button
              type="button"
              className="bb-btn bb-btn-secondary"
              onClick={() => onCopy(copyKey, selected.text)}
            >
              {copiedKey === copyKey ? "已复制" : "复制这一版"}
            </button>
          </div>
          <pre className="bb-prompt-text">{applyProjectName(selected.text, projectName)}</pre>
        </div>
      </div>
    </div>,
    document.body
  );
}
