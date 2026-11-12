"use client";

import { useRef, useState } from "react";
import { IconPencil, IconSearch, IconWrench } from "@/components/Icons";
import {
  ADMIN_AGENT_PROMPT,
  USER_AGENT_PROMPT,
  applyProjectName,
} from "@/lib/agent-prompts";

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

const PROMPTS = [
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
    summary: "故障就修好。没用对或配置不对标不属实，还没有的新能力交给产品经理确认。",
    icon: IconWrench,
    text: ADMIN_AGENT_PROMPT,
  },
] as const;

export function AgentPromptsAdmin() {
  const [projectName, setProjectName] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const copiedTimer = useRef<number | null>(null);

  async function copyPrompt(id: string, text: string) {
    const ok = await writeClipboard(applyProjectName(text, projectName));
    if (!ok) {
      setError("复制失败，请允许剪贴板权限后重试");
      return;
    }
    setError("");
    setCopiedId(id);
    if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopiedId(null), 2000);
  }

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
          先填写目标项目，复制时会写进提示词；留空则保留待填的那一行，贴到对话里再补。
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
              </div>
              <button
                type="button"
                className="bb-btn"
                onClick={() => copyPrompt(item.id, item.text)}
              >
                {copiedId === item.id ? "已复制" : "复制提示词"}
              </button>
            </div>
            <pre className="bb-prompt-text">{text}</pre>
          </section>
        );
      })}
      </div>
    </>
  );
}
