"use client";

import { useState } from "react";

export function RefreshFeatureMap({ projectId }: { projectId: number }) {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch(`/api/projects/${projectId}/ask/map`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        run?: { statusLine?: string; error?: string; status?: string };
      };
      if (!res.ok) {
        setMessage(data.error || "没有开始");
        return;
      }
      setMessage(data.run?.statusLine || data.run?.error || "已交给代码机。完成后刷新本页。");
    } catch {
      setMessage("网络异常，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bb-ask-actions">
      <button type="button" className="bb-btn bb-btn-secondary" onClick={() => void refresh()} disabled={loading}>
        {loading ? "发送中…" : "更新功能地图"}
      </button>
      {message ? <p className="bb-field-hint">{message}</p> : null}
    </div>
  );
}
