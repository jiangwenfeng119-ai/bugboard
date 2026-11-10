"use client";

import { useEffect, useRef, useState } from "react";
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

const UNHEARD = "没有识别到话";

export function CaptureReview({ projectId, initial }: { projectId: number; initial: Session }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [drafts, setDrafts] = useState(initial.drafts);
  const [index, setIndex] = useState(0);
  const [history, setHistory] = useState<Draft[][]>([]);
  const [stepsText, setStepsText] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const visible = drafts
    .map((draft, position) => ({ draft, position }))
    .filter((item) => item.draft.status === "draft" || item.draft.status === "kept");
  const current = visible[index]?.draft || visible[0]?.draft;
  const unseen = drafts.filter((draft) => draft.status === "draft").length;
  const keptCount = drafts.filter((draft) => draft.status === "kept").length;
  const currentPlace = current ? visible.findIndex((item) => item.draft.id === current.id) : -1;

  function remember(next: Draft[]) {
    setHistory((prev) => [...prev.slice(-30), drafts]);
    setDrafts(next);
  }

  function patch(id: number, partial: Partial<Draft>) {
    setDrafts((prev) => prev.map((draft) => (draft.id === id ? { ...draft, ...partial } : draft)));
  }

  function move(delta: number) {
    if (!visible.length) return;
    setIndex((value) => (value + delta + visible.length) % visible.length);
  }

  function keepOrDrop(status: "kept" | "discarded") {
    if (!current) return;
    const position = visible.findIndex((item) => item.draft.id === current.id);
    const next = drafts.map((draft) =>
      draft.id === current.id ? { ...draft, status, mergedIntoId: null } : draft
    );
    remember(next);
    if (status === "discarded") {
      const left = next.filter((draft) => draft.status === "draft" || draft.status === "kept");
      setIndex(Math.min(position, Math.max(0, left.length - 1)));
    }
  }

  function mergeUp() {
    if (!current || currentPlace <= 0) return;
    const previous = visible[currentPlace - 1]?.draft;
    if (!previous) return;
    remember(
      drafts.map((draft) => {
        if (draft.id === previous.id) {
          const steps = [...previous.steps, ...current.steps];
          const quote = [previous.quote, current.quote].filter(Boolean).join("\n");
          return {
            ...draft,
            quote,
            steps,
            body: bodyFrom(quote, steps, previous.question),
          };
        }
        if (draft.id === current.id) {
          return { ...draft, status: "merged" as const, mergedIntoId: previous.id };
        }
        return draft;
      })
    );
    setIndex(Math.max(0, currentPlace - 1));
  }

  function undo() {
    setHistory((prev) => {
      const last = prev[prev.length - 1];
      if (last) {
        setDrafts(last);
        setStepsText({});
      }
      return prev.slice(0, -1);
    });
  }

  function editQuote(value: string) {
    if (!current) return;
    const clear = current.question.includes(UNHEARD) && value.trim();
    const question = clear ? "" : current.question;
    patch(current.id, {
      quote: value,
      question,
      confidence: clear ? "ok" : current.confidence,
      body: bodyFrom(value, current.steps, question),
    });
  }

  function editSteps(raw: string) {
    if (!current) return;
    setStepsText((prev) => ({ ...prev, [current.id]: raw }));
    const steps = raw
      .split("\n")
      .map((step) => step.trim())
      .filter(Boolean);
    patch(current.id, { steps, body: bodyFrom(current.quote, steps, current.question) });
  }

  function jump() {
    const node = videoRef.current;
    if (!node || !current || current.evidenceSec == null) return;
    node.currentTime = current.evidenceSec;
    void node.play().catch(() => undefined);
  }

  const actions = useRef({ move, keepOrDrop, mergeUp, undo });
  actions.current = { move, keepOrDrop, mergeUp, undo };

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const key = event.key.toLowerCase();
      if (key === "j") actions.current.move(1);
      else if (key === "k") actions.current.move(-1);
      else if (key === "a") actions.current.keepOrDrop("kept");
      else if (key === "x") actions.current.keepOrDrop("discarded");
      else if (key === "m") actions.current.mergeUp();
      else if (key === "z" && !event.metaKey && !event.ctrlKey) actions.current.undo();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function finish() {
    if (unseen > 0) {
      setError("每条都要留下或丢掉，才能入库。");
      return;
    }
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
            留下的才会变成报障。标题、原话和步骤都可以改。
            {initial.truncated ? " 录像接近 50MB，已提前停下。" : ""}
          </p>
          <p className="bb-field-hint">键盘：J / K 切换，A 留下，X 丢掉，M 并进上一条，Z 撤销。</p>
        </div>
      </div>
      {initial.videoUrl ? (
        <video ref={videoRef} className="bb-cap-video" controls src={initial.videoUrl} />
      ) : null}
      {!current ? (
        <p className="bb-muted">没有还要看的草稿。结束之后不会新建报障。</p>
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
                  <span className="bb-cap-list-title">{item.draft.title}</span>
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
            {current.question ? (
              <p className={current.question.includes(UNHEARD) ? "bb-muted" : "bb-cap-question"}>
                {current.question}
              </p>
            ) : null}
            <label className="bb-label" htmlFor={`quote-${current.id}`}>
              原话
            </label>
            <textarea
              id={`quote-${current.id}`}
              className="bb-textarea"
              rows={3}
              value={current.quote}
              onChange={(event) => editQuote(event.target.value)}
              placeholder="看到的现象"
            />
            <label className="bb-label" htmlFor={`steps-${current.id}`}>
              步骤
            </label>
            <textarea
              id={`steps-${current.id}`}
              className="bb-textarea"
              rows={3}
              value={stepsText[current.id] ?? current.steps.join("\n")}
              onChange={(event) => editSteps(event.target.value)}
              placeholder="一行一个步骤"
            />
            {current.evidenceSec != null && initial.videoUrl ? (
              <button type="button" className="bb-btn bb-btn-ghost" onClick={jump}>
                跳到 {formatClock(current.evidenceSec)}
              </button>
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
              <button
                type="button"
                className="bb-btn bb-btn-ghost"
                onClick={mergeUp}
                disabled={currentPlace <= 0}
              >
                并进上一条
              </button>
            </div>
          </article>
        </div>
      )}
      {error ? <p className="bb-error">{error}</p> : null}
      <div className="bb-cap-actions">
        <button type="button" className="bb-btn bb-btn-ghost" onClick={undo} disabled={!history.length}>
          撤销
        </button>
        <button type="button" className="bb-btn" onClick={() => void finish()} disabled={busy || unseen > 0}>
          {busy ? "入库中…" : unseen > 0 ? `还有 ${unseen} 条没看` : keptCount ? "完成审核" : "结束，不建报障"}
        </button>
      </div>
      <p className="bb-muted">
        {unseen > 0
          ? "每条都要留下或丢掉，才能入库。"
          : keptCount
            ? `${keptCount} 条会变成报障。`
            : "没有留下的草稿，不会新建报障。"}
      </p>
    </div>
  );
}

function bodyFrom(quote: string, steps: string[], question: string) {
  const blocks: string[] = [];
  if (steps.length) {
    blocks.push("## 复现步骤", steps.map((step, index) => `${index + 1}. ${step}`).join("\n"));
  }
  if (question) blocks.push("## 待确认", question);
  if (!blocks.length) return quote;
  return blocks.join("\n\n");
}

function formatClock(total: number) {
  const seconds = Math.max(0, Math.round(total));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
