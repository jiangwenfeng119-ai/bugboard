"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AttachmentComposer,
  type PendingFile,
} from "@/components/AttachmentComposer";
import {
  ACTION_LABEL,
  type TransitionAction,
} from "@/lib/state-machine";
import type { Priority } from "@/lib/types";

const NOTE_ACTIONS = new Set<TransitionAction>([
  "mark_invalid",
  "submit_fix",
  "reject_fix",
  "dispute_invalid",
]);

export function BugActions({
  bugId,
  actions,
  isAdmin,
  currentPriority,
}: {
  bugId: number;
  actions: TransitionAction[];
  isAdmin: boolean;
  currentPriority: Priority;
}) {
  const router = useRouter();
  const [active, setActive] = useState<TransitionAction | null>(null);
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [priority, setPriority] = useState<Priority>(currentPriority);

  async function runSimple(action: TransitionAction) {
    if (NOTE_ACTIONS.has(action)) {
      setActive(action);
      setNote("");
      setFiles([]);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/bugs/${bugId}/transitions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          (data as { error?: string }).error || `操作失败（HTTP ${res.status}）`
        );
        return;
      }
      router.refresh();
    } catch {
      setError("网络异常，请重试");
    } finally {
      setLoading(false);
    }
  }

  async function submitNoted(e: FormEvent) {
    e.preventDefault();
    if (!active) return;
    setLoading(true);
    setError("");
    try {
      const form = new FormData();
      form.set("action", active);
      form.set("note", note);
      for (const f of files) form.append("files", f.file, f.file.name);
      const res = await fetch(`/api/bugs/${bugId}/transitions`, {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          (data as { error?: string }).error || `操作失败（HTTP ${res.status}）`
        );
        return;
      }
      setActive(null);
      router.refresh();
    } catch {
      setError("网络异常，请重试");
    } finally {
      setLoading(false);
    }
  }

  async function savePriority() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/bugs/${bugId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          (data as { error?: string }).error || `更新失败（HTTP ${res.status}）`
        );
        return;
      }
      router.refresh();
    } catch {
      setError("网络异常，请重试");
    } finally {
      setLoading(false);
    }
  }

  if (actions.length === 0 && !isAdmin) {
    return <p className="bb-muted" style={{ margin: 0 }}>当前无需你操作，可查看时间线。</p>;
  }

  return (
    <div>
      {actions.length > 0 ? (
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {actions.map((a) => (
            <button
              key={a}
              type="button"
              className={
                a === "mark_invalid" || a === "reject_fix"
                  ? "bb-btn bb-btn-danger"
                  : "bb-btn"
              }
              disabled={loading}
              onClick={() => runSimple(a)}
            >
              {ACTION_LABEL[a]}
            </button>
          ))}
        </div>
      ) : (
        <p className="bb-muted">当前状态没有可执行的流转操作。</p>
      )}

      {active ? (
        <form onSubmit={submitNoted} style={{ marginTop: "1rem" }}>
          <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.95rem" }}>
            {ACTION_LABEL[active]}
          </h3>
          <div className="bb-field">
            <label className="bb-label">说明（必填）</label>
            <textarea
              className="bb-textarea"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              required
            />
          </div>
          <div className="bb-field">
            <label className="bb-label">附件（可选）</label>
            <AttachmentComposer files={files} onChange={setFiles} />
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button className="bb-btn" type="submit" disabled={loading}>
              {loading ? "提交中…" : "确认提交"}
            </button>
            <button
              type="button"
              className="bb-btn bb-btn-ghost"
              onClick={() => setActive(null)}
            >
              取消
            </button>
          </div>
        </form>
      ) : null}

      {isAdmin ? (
        <div
          style={{
            marginTop: "1rem",
            paddingTop: "1rem",
            borderTop: "1px solid var(--line)",
            display: "flex",
            gap: "0.5rem",
            alignItems: "center",
          }}
        >
          <label className="bb-label" style={{ margin: 0, width: "auto" }}>
            优先级
          </label>
          <select
            className="bb-select"
            style={{ width: "auto" }}
            value={priority}
            onChange={(e) => setPriority(e.target.value as Priority)}
          >
            <option value="p1">P1</option>
            <option value="p2">P2</option>
            <option value="p3">P3</option>
          </select>
          <button
            type="button"
            className="bb-btn bb-btn-secondary"
            disabled={loading || priority === currentPriority}
            onClick={savePriority}
          >
            保存优先级
          </button>
        </div>
      ) : null}

      {error ? <p className="bb-error">{error}</p> : null}
    </div>
  );
}
