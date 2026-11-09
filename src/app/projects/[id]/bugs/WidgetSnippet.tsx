"use client";

import { useState } from "react";

export function WidgetSnippet({ projectId }: { projectId: number }) {
  const [open, setOpen] = useState(false);
  const [snippet, setSnippet] = useState("");
  const [error, setError] = useState("");

  async function load(rotate = false) {
    setError("");
    const res = await fetch(`/api/projects/${projectId}/widget`, { method: rotate ? "POST" : "GET" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError((data as { error?: string }).error || "没有生成上报脚本");
      return;
    }
    setSnippet((data as { snippet?: string }).snippet || "");
    setOpen(true);
  }

  return (
    <>
      <button type="button" className="bb-btn bb-btn-ghost" onClick={() => void load(false)}>
        网页上报
      </button>
      {open ? (
        <div className="bb-cap-layer" role="dialog" aria-modal="true" aria-label="网页上报脚本">
          <div className="bb-card bb-widget-card">
            <h2>嵌到业务网站</h2>
            <p className="bb-muted">
              把下面这一行放到被测网页。访客圈图或写一句后，会在这个项目里开一张单。提交人是当前管理员，确认也由这个账号完成。
            </p>
            <textarea className="bb-textarea" readOnly rows={3} value={snippet} />
            {error ? <p className="bb-error">{error}</p> : null}
            <div className="bb-cap-actions">
              <button
                type="button"
                className="bb-btn"
                onClick={() => void navigator.clipboard.writeText(snippet)}
              >
                复制
              </button>
              <button type="button" className="bb-btn bb-btn-ghost" onClick={() => void load(true)}>
                换一把
              </button>
              <button type="button" className="bb-btn bb-btn-ghost" onClick={() => setOpen(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
