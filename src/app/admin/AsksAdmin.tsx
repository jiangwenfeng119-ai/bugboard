"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AskAdminRecord, AskOptimizationRow } from "@/lib/ask-optimize";
import { judgmentLabel } from "@/lib/ask-core";
import { formatDateTime } from "@/lib/time";

const OPT_STATUS: Record<string, string> = {
  queued: "排队",
  sent: "处理中",
  failed: "失败",
  done: "已记下改动",
  reverting: "回滚中",
  reverted: "已回滚",
};

export function AsksAdmin({
  runs,
  selected,
  optimizations,
  selectedOptimization,
}: {
  runs: AskAdminRecord[];
  selected: AskAdminRecord | null;
  optimizations: AskOptimizationRow[];
  selectedOptimization: AskOptimizationRow | null;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");

  async function post(url: string, key: string) {
    setPending(key);
    setError("");
    try {
      const res = await fetch(url, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string; optimization?: { id: number } };
      if (!res.ok) {
        setError(data.error || `操作失败（HTTP ${res.status}）`);
        return;
      }
      const id = data.optimization?.id;
      router.push(id ? `/admin?tab=asks&opt=${id}` : "/admin?tab=asks");
      router.refresh();
    } catch {
      setError("网络异常，请重试");
    } finally {
      setPending("");
    }
  }

  return (
    <div className="bb-ask-admin">
      <section className="bb-card bb-section-card">
        <h2>问答记录</h2>
        <p className="bb-muted">点开一条可以看完整问答。提交优化会叫醒处理 Agent，只改问答规则，并把这次改动记下来。</p>
        {runs.length === 0 ? (
          <p className="bb-muted">还没有问答。</p>
        ) : (
          <div className="bb-table-wrap">
            <table className="bb-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>项目</th>
                  <th>提问人</th>
                  <th>判断</th>
                  <th>问题</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>{formatDateTime(run.createdAt)}</td>
                    <td>{run.projectName}</td>
                    <td>{run.actor}</td>
                    <td>{judgmentLabel(run.judgment) || run.status}</td>
                    <td>
                      <Link href={`/admin?tab=asks&run=${run.id}`}>{run.question}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected ? (
        <section className="bb-card bb-section-card">
          <h2>这条问答</h2>
          <p className="bb-muted">
            {selected.projectName} · {selected.actor} · {formatDateTime(selected.createdAt)} ·{" "}
            {judgmentLabel(selected.judgment) || selected.status}
          </p>
          <h3>问</h3>
          <pre className="bb-ask-record">{selected.question}</pre>
          <h3>答</h3>
          <pre className="bb-ask-record">{selected.answer || selected.error || "还没有回答"}</pre>
          <div className="bb-ask-admin-actions">
            <button
              type="button"
              className="bb-btn"
              disabled={pending !== "" || selected.status !== "done"}
              onClick={() => post(`/api/admin/asks/${selected.id}/optimize`, `run-${selected.id}`)}
            >
              {pending === `run-${selected.id}` ? "正在提交" : "提交优化"}
            </button>
            {selected.status !== "done" ? <span className="bb-muted">这条还没答完。</span> : null}
          </div>
        </section>
      ) : null}

      <section className="bb-card bb-section-card">
        <h2>优化记录</h2>
        <p className="bb-muted">每次提交都留在这里。点开可以看交给处理 Agent 的要求和具体改动，已记下的改动可以回滚。</p>
        {optimizations.length === 0 ? (
          <p className="bb-muted">还没有优化。</p>
        ) : (
          <div className="bb-table-wrap">
            <table className="bb-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>项目</th>
                  <th>状态</th>
                  <th>来源问题</th>
                </tr>
              </thead>
              <tbody>
                {optimizations.map((item) => (
                  <tr key={item.id}>
                    <td>{formatDateTime(item.createdAt)}</td>
                    <td>{item.projectName}</td>
                    <td>{OPT_STATUS[item.status] || item.status}</td>
                    <td>
                      <Link href={`/admin?tab=asks&opt=${item.id}`}>{item.question}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedOptimization ? (
        <section className="bb-card bb-section-card">
          <h2>这次优化</h2>
          <p className="bb-muted">
            {OPT_STATUS[selectedOptimization.status] || selectedOptimization.status}
            {selectedOptimization.detail ? ` · ${selectedOptimization.detail}` : ""}
            {selectedOptimization.commitSha ? ` · ${selectedOptimization.commitSha.slice(0, 7)}` : ""}
            {selectedOptimization.revertSha ? ` · 回滚 ${selectedOptimization.revertSha.slice(0, 7)}` : ""}
          </p>
          <p>
            <Link href={`/admin?tab=asks&run=${selectedOptimization.askRunId}`}>看原来的问答</Link>
          </p>
          {selectedOptimization.prompt ? (
            <details>
              <summary>交给处理 Agent 的要求</summary>
              <pre className="bb-ask-record">{selectedOptimization.prompt}</pre>
            </details>
          ) : null}
          <h3>改动</h3>
          {selectedOptimization.diff ? (
            <pre className="bb-ask-diff">{selectedOptimization.diff}</pre>
          ) : (
            <p className="bb-muted">还没有差异。处理结束后会记在这里。</p>
          )}
          {selectedOptimization.status === "done" && (selectedOptimization.commitSha || selectedOptimization.diff) ? (
            <div className="bb-ask-admin-actions">
              <button
                type="button"
                className="bb-btn bb-btn-secondary"
                disabled={pending !== ""}
                onClick={() =>
                  post(`/api/admin/asks/optimizations/${selectedOptimization.id}/revert`, `opt-${selectedOptimization.id}`)
                }
              >
                {pending === `opt-${selectedOptimization.id}` ? "正在回滚" : "回滚这次改动"}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {error ? <p className="bb-error">{error}</p> : null}
    </div>
  );
}
