"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Draft = {
  id: number;
  title: string;
  body: string;
  quote: string;
  steps: string[];
  evidenceSec: number | null;
  confidence: string;
  question: string;
  status: "draft" | "kept" | "discarded" | "merged";
  mergedIntoId: number | null;
  frameUrl: string | null;
};

type Session = {
  id: number;
  title: string;
  truncated: boolean;
  videoUrl: string | null;
  drafts: Draft[];
};

export function CaptureReview({ projectId, initial }: { projectId: number; initial: Session }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState(initial.drafts);
  const [index, setIndex] = useState(0);
  const [history, setHistory] = useState<Draft[][]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const visible = drafts
    .map((draft, position) => ({ draft, position }))
    .filter((item) => item.draft.status === "draft" || item.draft.status === "kept");
  const current = visible[index]?.draft || visible[0]?.draft;

  function remember(next: Draft[]) {
    setHistory((prev) => [...prev.slice(-30), drafts]);
    setDrafts(next);
  }

  function patch(id: number, partial: Partial<Draft>) {
    remember(drafts.map((draft) => (draft.id === id ? { ...draft, ...partial } : draft)));
  }

  function move(delta: number) {
    if (!visible.length) return;
    setIndex((value) => (value + delta + visible.length) % visible.length);
  }

  function keepOrDrop(status: "kept" | "discarded") {
    if (!current) return;
    const position = visible.findIndex((item) => item.draft.id === current.id);
    patch(current.id, { status, mergedIntoId: null });
    if (position >= visible.length - 2) setIndex(0);
  }

  function mergeUp() {
    if (!current) return;
    const position = visible.findIndex((item) => item.draft.id === current.id);
    const previous = visible[position - 1]?.draft;
    if (!previous) return;
    remember(
      drafts.map((draft) => {
        if (draft.id === previous.id) {
          return {
            ...draft,
            quote: [previous.quote, current.quote].filter(Boolean).join("\n"),
            steps: [...previous.steps, ...current.steps],
            body: [previous.body, current.body].filter(Boolean).join("\n\n"),
          };
        }
        if (draft.id === current.id) {
          return { ...draft, status: "merged" as const, mergedIntoId: previous.id };
        }
        return draft;
      })
    );
    setIndex(Math.max(0, position - 1));
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const key = event.key.toLowerCase();
      if (key === "j") move(1);
      else if (key === "k") move(-1);
      else if (key === "a") keepOrDrop("kept");
      else if (key === "x") keepOrDrop("discarded");
      else if (key === "m") mergeUp();
      else if (key === "z" && !event.metaKey && !event.ctrlKey) {
        setHistory((prev) => {
          const last = prev[prev.length - 1];
          if (last) setDrafts(last);
          return prev.slice(0, -1);
        });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function finish() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/projects/${projectId}/captures/${initial.id}/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        drafts: drafts.map((draft) => ({
          id: draft.id,
          title: draft.title,
          body: draft.body,
          quote: draft.quote,
          steps: draft.steps,
          question: draft.question,
          status: draft.status,
          mergedIntoId: draft.mergedIntoId,
        })),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError((data as { error?: string }).error || "没有入库");
      return;
    }
    const bugs = (data as { bugs?: { id: number }[] }).bugs || [];
    router.push(bugs.length === 1 ? `/bugs/${bugs[0].id}` : `/projects/${projectId}/bugs`);
    router.refresh();
  }

  return (
    <div className="bb-cap-review">
      <div className="bb-cap-review-head">
        <div>
          <h2>{initial.title}</h2>
          <p className="bb-muted">
            J / K 切换，A 留下，X 丢掉，M 并进上一条，Z 撤销。留下的才会变成报障。
            {initial.truncated ? " 录像接近 50MB，已提前停下。" : ""}
          </p>
        </div>
        {initial.videoUrl ? (
          <a className="bb-btn bb-btn-ghost" href={initial.videoUrl}>
            看录像
          </a>
        ) : null}
      </div>
      {!current ? (
        <p className="bb-muted">没有还要看的草稿。</p>
      ) : (
        <div className="bb-cap-review-grid">
          <ol className="bb-cap-list">
            {visible.map((item, itemIndex) => (
              <li key={item.draft.id}>
                <button
                  type="button"
                  className={`bb-cap-list-btn${item.draft.id === current.id ? " is-on" : ""}`}
                  onClick={() => setIndex(itemIndex)}
                >
                  <span className={`bb-cap-state is-${item.draft.status}`}>
                    {item.draft.status === "kept" ? "留下" : "未看"}
                  </span>
                  {item.draft.title}
                </button>
              </li>
            ))}
          </ol>
          <article className="bb-card bb-section-card">
            <label className="bb-label" htmlFor={`draft-${current.id}`}>
              标题
            </label>
            <input
              id={`draft-${current.id}`}
              className="bb-input"
              value={current.title}
              onChange={(event) => patch(current.id, { title: event.target.value })}
            />
            {current.confidence === "low" ? <p className="bb-cap-question">{current.question}</p> : null}
            <p>{current.quote}</p>
            {current.evidenceSec != null ? (
              <p className="bb-muted">时间点 {formatClock(current.evidenceSec)}</p>
            ) : null}
            {current.steps.length ? (
              <ol>
                {current.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            ) : null}
            {current.frameUrl ? (
              // 草稿截图来自本系统，地址由服务端签发。
              // eslint-disable-next-line @next/next/no-img-element
              <img className="bb-evidence-img" src={current.frameUrl} alt="" />
            ) : null}
            <div className="bb-cap-actions">
              <button type="button" className="bb-btn" onClick={() => keepOrDrop("kept")}>
                留下
              </button>
              <button type="button" className="bb-btn bb-btn-ghost" onClick={() => keepOrDrop("discarded")}>
                丢掉
              </button>
              <button type="button" className="bb-btn bb-btn-ghost" onClick={mergeUp}>
                并进上一条
              </button>
            </div>
          </article>
        </div>
      )}
      {error ? <p className="bb-error">{error}</p> : null}
      <div className="bb-cap-actions">
        <button type="button" className="bb-btn" onClick={() => void finish()} disabled={busy}>
          {busy ? "入库中…" : "完成审核"}
        </button>
      </div>
    </div>
  );
}

function formatClock(total: number) {
  const seconds = Math.max(0, Math.round(total));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
