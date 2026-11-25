"use client";

import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  queue,
}: {
  runs: AskAdminRecord[];
  selected: AskAdminRecord | null;
  optimizations: AskOptimizationRow[];
  selectedOptimization: AskOptimizationRow | null;
  queue: { ready: number; busy: boolean };
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");

  const close = useCallback(() => {
    router.push("/admin?tab=asks");
  }, [router]);

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

  const batchLabel = queue.busy
    ? "有优化在处理"
    : queue.ready > 0
      ? `一键提交未优化（${queue.ready}）`
      : "一键提交未优化";

  return (
    <div className="bb-ask-admin">
      <section className="bb-card bb-section-card">
        <div className="bb-section-head">
          <h2>问答记录</h2>
          <button
            type="button"
            className="bb-btn"
            disabled={pending !== "" || queue.busy || queue.ready === 0}
            onClick={() => post("/api/admin/asks/optimize-open", "batch")}
          >
            {pending === "batch" ? "正在提交" : batchLabel}
          </button>
        </div>
        <p className="bb-muted">
          点一条在弹窗里看完整问答。一键提交会把还没优化过、并且已经答完的问答交给处理 Agent，由它判断要不要改、怎么改。
        </p>
        {queue.busy ? <p className="bb-muted">等这次优化结束，再提交剩下的。</p> : null}
        {error && !selected && !selectedOptimization ? <p className="bb-error">{error}</p> : null}
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
                  <tr
                    key={run.id}
                    className={selected?.id === run.id ? "bb-ask-pick is-current" : "bb-ask-pick"}
                    tabIndex={0}
                    role="button"
                    aria-haspopup="dialog"
                    aria-label={`查看问答：${run.question.slice(0, 80)}`}
                    onClick={() => router.push(`/admin?tab=asks&run=${run.id}`)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      router.push(`/admin?tab=asks&run=${run.id}`);
                    }}
                  >
                    <td>{formatDateTime(run.createdAt)}</td>
                    <td>{run.projectName}</td>
                    <td>{run.actor}</td>
                    <td>{judgmentLabel(run.judgment) || run.status}</td>
                    <td>{run.question}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected ? (
        <RecordDialog title="这条问答" onClose={close} busy={pending !== ""}>
          <p className="bb-muted">
            {selected.projectName} · {selected.actor} · {formatDateTime(selected.createdAt)} ·{" "}
            {judgmentLabel(selected.judgment) || selected.status}
          </p>
          <h3>问</h3>
          <pre className="bb-ask-record">{selected.question}</pre>
          <h3>答</h3>
          <pre className="bb-ask-record">{selected.answer || selected.error || "还没有回答"}</pre>
          {error ? <p className="bb-error">{error}</p> : null}
          <div className="bb-ask-admin-actions">
            <button
              type="button"
              className="bb-btn"
              disabled={pending !== "" || selected.status !== "done" || queue.busy}
              onClick={() => post(`/api/admin/asks/${selected.id}/optimize`, `run-${selected.id}`)}
            >
              {pending === `run-${selected.id}` ? "正在提交" : "提交优化"}
            </button>
            {selected.status !== "done" ? <span className="bb-muted">这条还没答完。</span> : null}
            {queue.busy && selected.status === "done" ? (
              <span className="bb-muted">已有优化在处理。</span>
            ) : null}
          </div>
        </RecordDialog>
      ) : null}

      <section className="bb-card bb-section-card">
        <h2>优化记录</h2>
        <p className="bb-muted">每次提交都留在这里。点一条在弹窗里看交给处理 Agent 的要求和具体改动，已记下的改动可以回滚。</p>
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
                  <tr
                    key={item.id}
                    className={selectedOptimization?.id === item.id ? "bb-ask-pick is-current" : "bb-ask-pick"}
                    tabIndex={0}
                    role="button"
                    aria-haspopup="dialog"
                    aria-label={`查看优化：${item.question.slice(0, 80)}`}
                    onClick={() => router.push(`/admin?tab=asks&opt=${item.id}`)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      router.push(`/admin?tab=asks&opt=${item.id}`);
                    }}
                  >
                    <td>{formatDateTime(item.createdAt)}</td>
                    <td>{item.projectName}</td>
                    <td>{OPT_STATUS[item.status] || item.status}</td>
                    <td>{item.question}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedOptimization ? (
        <RecordDialog title="这次优化" onClose={close} busy={pending !== ""}>
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
          {error ? <p className="bb-error">{error}</p> : null}
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
        </RecordDialog>
      ) : null}
    </div>
  );
}

function RecordDialog({
  title,
  onClose,
  busy,
  children,
}: {
  title: string;
  onClose: () => void;
  busy: boolean;
  children: ReactNode;
}) {
  const titleId = useId();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    document.body.classList.add("bb-modal-open");
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("bb-modal-open");
      window.removeEventListener("keydown", onKey);
    };
  }, [mounted, busy, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className="bb-modal" role="presentation">
      <button type="button" className="bb-modal-backdrop" aria-label="关闭" onClick={() => (busy ? undefined : onClose())} />
      <div className="bb-modal-card bb-ask-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="bb-sheet-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="bb-btn bb-btn-ghost" onClick={onClose} disabled={busy}>
            关闭
          </button>
        </div>
        <div className="bb-sheet-body">{children}</div>
      </div>
    </div>,
    document.body
  );
}
