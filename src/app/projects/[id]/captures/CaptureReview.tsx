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
  organizeStatus?: string;
  organizeDetail?: string;
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
  const [organizeStatus, setOrganizeStatus] = useState(initial.organizeStatus || "ready");
  const [organizeDetail, setOrganizeDetail] = useState(initial.organizeDetail || "");
  const organizing = organizeStatus === "organizing";
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

  function focusUnseen(list: Draft[], from: number) {
    const left = list.filter((draft) => draft.status === "draft" || draft.status === "kept");
    const later = left.findIndex((draft, itemIndex) => itemIndex > from && draft.status === "draft");
    if (later >= 0) {
      setIndex(later);
      return;
    }
    const earlier = left.findIndex((draft) => draft.status === "draft");
    if (earlier >= 0) setIndex(earlier);
  }

  function keepOrDrop(status: "kept" | "discarded") {
    if (!current) return;
    const position = visible.findIndex((item) => item.draft.id === current.id);
    if (status === "kept" && current.status === "kept") {
      focusUnseen(drafts, position);
      return;
    }
    const next = drafts.map((draft) =>
      draft.id === current.id ? { ...draft, status, mergedIntoId: null } : draft
    );
    remember(next);
    if (status === "discarded") {
      const left = next.filter((draft) => draft.status === "draft" || draft.status === "kept");
      setIndex(Math.min(position, Math.max(0, left.length - 1)));
      return;
    }
    focusUnseen(next, position);
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
    document.body.classList.add("bb-review-open");
    return () => document.body.classList.remove("bb-review-open");
  }, []);

  const currentId = current?.id;
  const evidenceAt = current?.evidenceSec;
  useEffect(() => {
    if (currentId == null) return;
    document.getElementById(`cap-draft-${currentId}`)?.scrollIntoView({ block: "nearest" });
  }, [currentId]);

  useEffect(() => {
    const node = videoRef.current;
    if (!node || evidenceAt == null) return;
    const seek = () => {
      if (Math.abs(node.currentTime - evidenceAt) > 0.2) node.currentTime = evidenceAt;
      node.pause();
    };
    if (node.readyState >= 1) seek();
    else node.addEventListener("loadedmetadata", seek, { once: true });
    return () => node.removeEventListener("loadedmetadata", seek);
  }, [currentId, evidenceAt]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (organizing) return;
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
  }, [organizing]);

  useEffect(() => {
    if (!organizing) return;
    let stopped = false;
    async function pull() {
      const res = await fetch(`/api/projects/${projectId}/captures/${initial.id}`);
      if (!res.ok || stopped) return;
      const data = (await res.json()) as { session?: Session };
      const session = data.session;
      if (!session || session.organizeStatus === "organizing") return;
      setOrganizeStatus(session.organizeStatus || "ready");
      setOrganizeDetail(session.organizeDetail || "");
      setDrafts(session.drafts);
      setHistory([]);
      setStepsText({});
      setIndex(0);
    }
    const timer = window.setInterval(() => void pull(), 3000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [organizing, projectId, initial.id]);

  async function skipOrganize() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/projects/${projectId}/captures/${initial.id}/organize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "skip" }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; session?: Session };
    setBusy(false);
    if (!res.ok || !data.session) {
      setError(data.error || "没有停下来");
      return;
    }
    setOrganizeStatus(data.session.organizeStatus || "skipped");
    setOrganizeDetail(data.session.organizeDetail || "");
  }

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

  const keptHere = current?.status === "kept";
  const canFinish = !busy && !organizing && unseen === 0;
  const note = !current
    ? "没有还要看的草稿。结束之后不会新建报障。"
    : unseen > 0
      ? keptHere
        ? `这条会入库。还有 ${unseen} 条没看。`
        : `还有 ${unseen} 条没看。这条留下或丢掉之后，才能入库。`
      : keptCount
        ? `${keptCount} 条会变成报障。`
        : "没有留下的草稿，不会新建报障。";

  return (
    <div className="bb-cap-review">
      <div className="bb-cap-review-head">
        <div>
          <h2>{initial.title}</h2>
          <p className="bb-muted">
            留下的才会变成报障。标题、原话和步骤都可以改。
            {initial.truncated ? " 录像接近 50MB，已提前停下。" : ""}
          </p>
        </div>
        <p className="bb-field-hint">J / K 切换，A 留下，X 丢掉，M 并进上一条，Z 撤销。</p>
      </div>
      {organizing ? (
        <div className="bb-cap-organize">
          <p>本机 agent 正在整理。下面是按停顿切开的初稿，整理完会换成它的结果。</p>
          <button type="button" className="bb-btn bb-btn-secondary" onClick={() => void skipOrganize()} disabled={busy}>
            不等了，用现在的草稿
          </button>
        </div>
      ) : organizeDetail ? (
        <p className="bb-cap-organize">{organizeDetail}</p>
      ) : null}
      {!current ? (
        <p className="bb-muted">没有还要看的草稿。结束之后不会新建报障。</p>
      ) : (
        <div className="bb-cap-review-body">
          <ol className="bb-cap-list">
            {visible.map((item, itemIndex) => (
              <li key={item.draft.id}>
                <button
                  id={`cap-draft-${item.draft.id}`}
                  type="button"
                  className={`bb-cap-list-btn${item.draft.id === current.id ? " is-on" : ""}`}
                  aria-current={item.draft.id === current.id ? "true" : undefined}
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
          <div className={`bb-cap-work${initial.videoUrl ? " has-video" : ""}`}>
            {initial.videoUrl ? (
              <div className="bb-cap-video-wrap">
                <video ref={videoRef} className="bb-cap-video" controls src={initial.videoUrl} />
              </div>
            ) : null}
            <div className="bb-cap-editor">
              {current.frameUrl ? (
                <figure className="bb-cap-mark">
                  {/* 圈选截图由服务端签发，笔迹已经画在图上。 */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={current.frameUrl} alt="圈住的画面" />
                </figure>
              ) : null}
              <label className="bb-label" htmlFor={`draft-${current.id}`}>
                标题
              </label>
              <input
                id={`draft-${current.id}`}
                className="bb-input"
                value={current.title}
                onChange={(event) => patch(current.id, { title: event.target.value })}
                disabled={organizing}
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
                disabled={organizing}
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
                disabled={organizing}
              />
              {current.evidenceSec != null && initial.videoUrl ? (
                <button type="button" className="bb-btn bb-btn-ghost" onClick={jump}>
                  跳到 {formatClock(current.evidenceSec)}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}
      {error ? <p className="bb-error">{error}</p> : null}
      <div className="bb-cap-dock">
        <button
          type="button"
          className={keptHere ? "bb-btn bb-btn-secondary" : "bb-btn"}
          onClick={() => keepOrDrop("kept")}
          disabled={!current || organizing}
        >
          {keptHere ? "已留下" : "留下"}
        </button>
        <button
          type="button"
          className="bb-btn bb-btn-ghost"
          onClick={() => keepOrDrop("discarded")}
          disabled={!current || organizing}
        >
          丢掉
        </button>
        <button
          type="button"
          className="bb-btn bb-btn-ghost"
          onClick={mergeUp}
          disabled={!current || currentPlace <= 0 || organizing}
        >
          并进上一条
        </button>
        <p className="bb-muted">{note}</p>
        <button type="button" className="bb-btn bb-btn-ghost" onClick={undo} disabled={!history.length || organizing}>
          撤销
        </button>
        <button
          type="button"
          className={canFinish ? "bb-btn" : "bb-btn bb-btn-secondary"}
          onClick={() => void finish()}
          disabled={!canFinish}
        >
          {busy ? "入库中…" : unseen === 0 && keptCount === 0 ? "结束，不建报障" : "完成审核"}
        </button>
      </div>
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
