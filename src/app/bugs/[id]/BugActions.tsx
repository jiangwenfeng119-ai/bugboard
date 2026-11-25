"use client";

import { FormEvent, useId, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AttachmentComposer,
  type PendingFile,
} from "@/components/AttachmentComposer";
import { Prose } from "@/components/Prose";
import {
  ACTION_LABEL,
  type TransitionAction,
} from "@/lib/state-machine";
import {
  bugPageActions,
  isDangerBugAction,
  nextStepButtonClass,
  nextStepIdleCopy,
  primaryBugAction,
  supplementNoteHint,
} from "./bug-page-actions";
import type { BugStatus, Priority } from "@/lib/types";

const NOTE_ACTIONS = new Set<TransitionAction>([
  "mark_invalid",
  "request_product",
  "decline_product",
  "request_info",
  "provide_info",
  "submit_fix",
  "reject_fix",
  "dispute_invalid",
  "reopen_invalid",
  "withdraw_fix",
  "release_return",
]);

const NOTE_HINT: Partial<Record<TransitionAction, string>> = {
  submit_fix:
    "写给报障人，用 Markdown 分成三段：## 原来的问题、## 现在的表现、## 请这样重测。重测步骤用 1. 2. 。用界面上的说法，不要写文件名或实现细节。",
  mark_invalid:
    "写给报障人：实际做了什么、看到了什么、为什么和报障对不上。已经有这个功能、只是没用对或配置不对时用这个。",
  request_product:
    "写给产品经理：现在界面上是怎样的，这张单想要的新能力是什么，以及对照项目资料和相邻功能的建议。建议不是决定。这次先不改。",
  decline_product:
    "写给报障人：为什么这次不做。报障人之后可以认可，也可以提出异议。",
  request_info:
    "写清已经查过什么，以及还缺报障人哪一份材料。缺的应是账号、机型、崩溃记录或操作记录。",
  provide_info: "写上补了什么。可以同时附上截图或记录。",
  reopen_invalid: "写清上次漏看或判错的是哪一处。",
  withdraw_fix: "写清为什么先收回这次修复说明，还有哪一点要再改。",
  release_return: "写清为什么退回待处理。这句会叫醒修复，并要按这句重做。",
};

type ActiveAction = TransitionAction | "add_supplement";

export function BugActions({
  bugId,
  status,
  actions,
  canSupplement = false,
  isAdmin,
  currentPriority,
  waitCopy = "",
  retestNote = "",
}: {
  bugId: number;
  status: BugStatus;
  actions: TransitionAction[];
  canSupplement?: boolean;
  isAdmin: boolean;
  currentPriority: Priority;
  waitCopy?: string;
  retestNote?: string;
}) {
  const router = useRouter();
  const [active, setActive] = useState<ActiveAction | null>(null);
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const noteId = useId();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [priority, setPriority] = useState<Priority>(currentPriority);
  const pageActions = bugPageActions(actions);

  function openNoted(action: ActiveAction) {
    setActive(action);
    setNote("");
    setFiles([]);
    setError("");
  }

  async function runSimple(action: TransitionAction) {
    if (NOTE_ACTIONS.has(action)) {
      openNoted(action);
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
      form.set("note", note);
      for (const f of files) form.append("files", f.file, f.file.name);
      const res =
        active === "add_supplement"
          ? await fetch(`/api/bugs/${bugId}/supplements`, {
              method: "POST",
              body: form,
            })
          : await (() => {
              form.set("action", active);
              return fetch(`/api/bugs/${bugId}/transitions`, {
                method: "POST",
                body: form,
              });
            })();
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

  const contextNotes = (
    <>
      {waitCopy ? <p className="bb-next-note">{waitCopy}</p> : null}
      {status === "awaiting_confirm" && retestNote ? (
        <div className="bb-next-note">
          <p className="bb-label">重测说明</p>
          <Prose text={retestNote} />
        </div>
      ) : null}
    </>
  );

  if (pageActions.length === 0 && !canSupplement && !isAdmin) {
    return (
      <div>
        {contextNotes}
        {waitCopy ? null : (
          <p className="bb-muted" style={{ margin: 0 }}>
            {nextStepIdleCopy(status)}
          </p>
        )}
      </div>
    );
  }

  const primary = primaryBugAction(pageActions);
  const progressActions = pageActions.filter((action) => !isDangerBugAction(action));
  const dangerActions = pageActions.filter((action) => isDangerBugAction(action));

  function actionButton(action: TransitionAction) {
    const selected = active === action;
    return (
      <button
        key={action}
        type="button"
        className={nextStepButtonClass(action, { active, primary })}
        aria-pressed={selected}
        disabled={loading}
        onClick={() => runSimple(action)}
      >
        {ACTION_LABEL[action]}
      </button>
    );
  }

  return (
    <div>
      {contextNotes}
      {pageActions.length > 0 || canSupplement ? (
        <div
          className="bb-bug-next-actions"
          style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}
        >
          {progressActions.map(actionButton)}
          {canSupplement ? (
            <button
              type="button"
              className={nextStepButtonClass("add_supplement", { active, primary })}
              aria-pressed={active === "add_supplement"}
              disabled={loading}
              onClick={() => openNoted("add_supplement")}
            >
              补充说明
            </button>
          ) : null}
          {dangerActions.map(actionButton)}
        </div>
      ) : (
        <p className="bb-muted">
          这一步在等别人处理。你可以先看时间线；有可做的操作时会出现在这里。
        </p>
      )}

      {active ? (
        <form onSubmit={submitNoted} style={{ marginTop: "1rem" }}>
          <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.875rem", fontWeight: 600, letterSpacing: 0 }}>
            {active === "add_supplement" ? "补充说明" : ACTION_LABEL[active]}
          </h3>
          <div className="bb-field">
            <label className="bb-label" htmlFor={noteId}>
              说明（必填）
            </label>
            {active === "add_supplement" ? (
              <p className="bb-muted" style={{ margin: "0 0 0.35rem" }}>
                {supplementNoteHint(status)}
              </p>
            ) : NOTE_HINT[active] ? (
              <p className="bb-muted" style={{ margin: "0 0 0.35rem" }}>
                {NOTE_HINT[active]}
              </p>
            ) : null}
            <p className="bb-field-hint">支持 Markdown：二级标题、空行分段、1. 步骤。</p>
            <textarea
              id={noteId}
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
