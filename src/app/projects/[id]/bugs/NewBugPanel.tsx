"use client";

import { FormEvent, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  AttachmentComposer,
  type PendingFile,
} from "@/components/AttachmentComposer";
import { CaptureTools } from "@/components/CaptureTools";
import { BUG_BODY_MAX, BUG_TITLE_MAX } from "@/lib/limits";
import type { Stroke } from "@/lib/strokes";
import { PRIORITY_HINT, PRIORITY_LABEL, type Priority } from "@/lib/types";

const PRIORITIES = Object.keys(PRIORITY_LABEL) as Priority[];

export function NewBugPanel({ projectId }: { projectId: number }) {
  const router = useRouter();
  const titleId = useId();
  const priorityId = useId();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<Priority>("p2");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [quote, setQuote] = useState("");
  const [steps, setSteps] = useState<string[]>([]);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [confidence, setConfidence] = useState("");
  const [openQuestion, setOpenQuestion] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  function resetDraft() {
    setFiles((prev) => {
      for (const file of prev) {
        if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
      }
      return [];
    });
    setTitle("");
    setBody("");
    setPriority("p2");
    setQuote("");
    setSteps([]);
    setStrokes([]);
    setConfidence("");
    setOpenQuestion("");
    setError("");
  }

  function addCapturedFile(file: File) {
    setFiles((prev) => {
      if (prev.length >= 20 || file.size > 50 * 1024 * 1024) return prev;
      const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      return [...prev, { id: `${Date.now()}-${file.name}`, file, previewUrl }];
    });
  }

  function applySpoken(text: string) {
    const clean = text.trim();
    if (!clean) return;
    setQuote(clean);
    setTitle((current) => current.trim() || Array.from(clean).slice(0, 42).join(""));
    setBody((current) => current.trim() || clean);
  }

  function closePanel() {
    setOpen(false);
    resetDraft();
  }

  useEffect(() => {
    if (!open) return;
    document.body.classList.add("bb-sheet-open");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("bb-sheet-open");
      window.removeEventListener("keydown", onKey);
    };
    // closePanel only resets draft state; rebinding on every keystroke is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const form = new FormData();
      form.set("title", title);
      form.set("body", body);
      form.set("priority", priority);
      form.set("quote", quote);
      form.set("steps", JSON.stringify(steps));
      form.set("strokes", JSON.stringify(strokes));
      form.set("confidence", confidence);
      form.set("openQuestion", openQuestion);
      for (const f of files) form.append("files", f.file, f.file.name);
      const res = await fetch(`/api/projects/${projectId}/bugs`, {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          (data as { error?: string }).error || `创建失败（HTTP ${res.status}）`
        );
        return;
      }
      resetDraft();
      setOpen(false);
      router.push(`/bugs/${(data as { bug: { id: number } }).bug.id}`);
      router.refresh();
    } catch {
      setError("网络异常，请重试");
    } finally {
      setLoading(false);
    }
  }

  const sheet = open ? (
    <div className="bb-panel" role="presentation">
      <button
        type="button"
        className="bb-panel-backdrop"
        aria-label="关闭新建报障"
        onClick={closePanel}
      />
      <form
        className="bb-panel-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={onSubmit}
      >
        <div className="bb-sheet-head">
          <div>
            <h2 id={titleId}>新建报障</h2>
            <p className="bb-muted">写清现象，选好优先级，需要的话再补附件。</p>
          </div>
          <button type="button" className="bb-btn bb-btn-ghost" onClick={closePanel}>
            关闭
          </button>
        </div>

        <div className="bb-sheet-body">
          <div className="bb-field">
            <label className="bb-label" htmlFor={`${titleId}-title`}>
              标题
            </label>
            <input
              id={`${titleId}-title`}
              className="bb-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="一句话说明哪里不对"
              maxLength={BUG_TITLE_MAX}
              autoFocus
              required
            />
          </div>

          <div className="bb-field">
            <label className="bb-label" htmlFor={`${titleId}-body`}>
              描述
            </label>
            <textarea
              id={`${titleId}-body`}
              className="bb-textarea"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={"## 环境\n\n## 复现步骤\n1. \n\n## 期望\n\n## 实际"}
              maxLength={BUG_BODY_MAX}
              rows={7}
            />
            <p className="bb-field-hint">支持 Markdown：二级标题、空行分段、1. 步骤。</p>
          </div>

          <div className="bb-field">
            <div className="bb-label" id={priorityId}>
              优先级
            </div>
            <div className="bb-priority-grid" role="radiogroup" aria-labelledby={priorityId}>
              {PRIORITIES.map((p) => {
                const name = PRIORITY_LABEL[p].replace(/^P\d\s*/, "");
                return (
                  <label
                    key={p}
                    className={`bb-priority-card is-${p}${priority === p ? " is-on" : ""}`}
                  >
                    <input
                      type="radio"
                      name={`${titleId}-priority`}
                      checked={priority === p}
                      onChange={() => setPriority(p)}
                    />
                    <span className={`bb-priority-kicker bb-priority-${p}`}>
                      {p.toUpperCase()}
                    </span>
                    <strong>{name}</strong>
                    <span className="bb-muted">{PRIORITY_HINT[p]}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <CaptureTools
            projectId={projectId}
            draftPending={Boolean(title.trim() || body.trim() || files.length || quote.trim())}
            onSnap={({ file, note, strokes: marks }) => {
              addCapturedFile(file);
              setStrokes(marks);
              applySpoken(note);
            }}
            onVoice={({ file, text }) => {
              addCapturedFile(file);
              applySpoken(text);
            }}
          />

          <div className="bb-field bb-attach-field">
            <div className="bb-label">附件</div>
            <AttachmentComposer files={files} onChange={setFiles} compact />
          </div>

          {error ? <p className="bb-error">{error}</p> : null}
        </div>

        <div className="bb-sheet-foot">
          <button type="button" className="bb-btn bb-btn-ghost" onClick={closePanel}>
            取消
          </button>
          <button className="bb-btn" type="submit" disabled={loading}>
            {loading ? "提交中…" : "提交报障"}
          </button>
        </div>
      </form>
    </div>
  ) : null;

  return (
    <>
      <button
        type="button"
        className="bb-btn"
        onClick={() => setOpen(true)}
      >
        新建报障
      </button>
      {mounted && sheet ? createPortal(sheet, document.body) : null}
    </>
  );
}
