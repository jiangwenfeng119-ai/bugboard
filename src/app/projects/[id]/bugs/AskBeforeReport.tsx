"use client";

import { useEffect, useId, useState } from "react";
import { bugBodyUntouched } from "@/lib/bug-body";
import { answerPieces, fillBugDraft, judgmentLabel, type AskJudgment, type AskStatus } from "@/lib/ask-core";
import { speechSupported, startLiveSpeech } from "@/components/live-speech";

type AskRun = {
  id: number;
  question: string;
  status: AskStatus;
  judgment: AskJudgment;
  answer: string;
  statusLine: string;
  error: string;
  cached: boolean;
  updatedAt: string;
};

export function AskBeforeReport({
  projectId,
  title,
  body,
  repoUrl = "",
  branch = "",
  seed = "",
  onFill,
}: {
  projectId: number;
  title: string;
  body: string;
  repoUrl?: string;
  branch?: string;
  seed?: string;
  onFill?: (next: { title: string; body: string }) => void;
}) {
  const labelId = useId();
  const [threadId] = useState(() => crypto.randomUUID().replace(/-/g, "").slice(0, 20));
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<AskRun[]>([]);
  const [sending, setSending] = useState(false);
  const [hint, setHint] = useState("");
  const [formError, setFormError] = useState("");
  const [hearing, setHearing] = useState(false);
  const [canHear, setCanHear] = useState(false);
  const liveId = [...turns].reverse().find((turn) => turn.status === "streaming")?.id ?? 0;

  useEffect(() => {
    setCanHear(speechSupported());
  }, []);

  useEffect(() => {
    if (seed) setQuestion((current) => current || seed);
  }, [seed]);

  useEffect(() => {
    if (!liveId) return;
    const source = new EventSource(`/api/projects/${projectId}/ask/${liveId}/events`);
    const apply = (run: AskRun) => {
      setTurns((prev) => prev.map((item) => (item.id === run.id ? run : item)));
    };
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { run?: AskRun };
        if (!data.run) return;
        apply(data.run);
        if (data.run.status !== "streaming") source.close();
      } catch {
        // 半包的事件留给下一次
      }
    };
    return () => source.close();
  }, [liveId, projectId]);

  async function ask(text: string, force: boolean) {
    const clean = text.trim();
    if (!clean || sending) return;
    setSending(true);
    setFormError("");
    setHint("");
    try {
      const res = await fetch(`/api/projects/${projectId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: clean, threadId, force }),
      });
      const data = (await res.json().catch(() => ({}))) as { run?: AskRun; error?: string };
      if (!res.ok || !data.run) {
        setFormError(data.error || "没有发出去");
        return;
      }
      setTurns((prev) => [...prev, data.run as AskRun]);
      if (!force) setQuestion("");
    } catch {
      setFormError("网络异常，请重试");
    } finally {
      setSending(false);
    }
  }

  async function stop(run: AskRun) {
    const res = await fetch(`/api/projects/${projectId}/ask/${run.id}/stop`, { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as { run?: AskRun };
    if (data.run) setTurns((prev) => prev.map((item) => (item.id === data.run?.id ? data.run : item)));
  }

  function fill(run: AskRun) {
    if (!onFill) return;
    onFill(
      fillBugDraft({
        question: run.question,
        answer: run.answer,
        title,
        body,
        bodyUntouched: bugBodyUntouched(body),
      })
    );
    setHint("已填入，提交前请改一改");
  }

  const streaming = liveId !== 0;

  return (
    <section className="bb-ask" aria-labelledby={labelId}>
      <div className="bb-ask-head">
        <h3 id={labelId}>先问这个项目</h3>
        <p>不确定功能有没有、入口在哪，可以先问。只回答，不改代码，也不替你提交。</p>
      </div>

      {turns.length > 0 ? (
        <div className="bb-ask-log">
          {turns.map((turn, index) => {
            const open = index === turns.length - 1;
            if (open) {
              return (
                <AskTurn
                  key={turn.id}
                  turn={turn}
                  repoUrl={repoUrl}
                  branch={branch}
                  onFill={onFill ? () => fill(turn) : undefined}
                  onStop={() => void stop(turn)}
                  onRefresh={() => void ask(turn.question, true)}
                />
              );
            }
            const label = judgmentLabel(turn.judgment);
            return (
              <details key={turn.id} className="bb-ask-earlier">
                <summary>{turn.question}</summary>
                {turn.answer ? <AnswerText text={turn.answer} repoUrl={repoUrl} branch={branch} /> : null}
                {label ? <span className={`bb-ask-judge is-${turn.judgment}`}>{label}</span> : null}
                {turn.error ? <p className="bb-error">{turn.error}</p> : null}
              </details>
            );
          })}
        </div>
      ) : null}

      <div className="bb-ask-form">
        <label className="bb-label" htmlFor={`${labelId}-q`}>
          问题
        </label>
        <textarea
          id={`${labelId}-q`}
          className="bb-textarea bb-ask-input"
          value={question}
          maxLength={2000}
          rows={2}
          placeholder="例如：会员积分的入口在哪里？"
          disabled={sending || streaming}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void ask(question, false);
            }
          }}
        />
        <div className="bb-ask-actions">
          <button
            className="bb-btn bb-btn-secondary"
            type="button"
            disabled={sending || streaming || !question.trim()}
            onClick={() => void ask(question, false)}
          >
            {sending ? "发送中…" : "提问"}
          </button>
          {canHear ? (
            <button
              type="button"
              className="bb-btn bb-btn-ghost"
              disabled={sending || streaming}
              onClick={() => {
                if (hearing) return;
                const heard = startLiveSpeech({
                  onPartial: (text) => setQuestion(text),
                  onFinal: (text) => setQuestion((current) => (current && !current.endsWith(text) ? `${current}${text}` : text || current)),
                  onEnd: () => setHearing(false),
                });
                setHearing(Boolean(heard));
              }}
            >
              {hearing ? "正在听…" : "说一句"}
            </button>
          ) : null}
          <p className="bb-field-hint">Enter 发送，Shift+Enter 换行。</p>
        </div>
      </div>
      {hint ? <p className="bb-ask-hint">{hint}</p> : null}
      {formError ? <p className="bb-error">{formError}</p> : null}
    </section>
  );
}

function AskTurn({
  turn,
  repoUrl,
  branch,
  onFill,
  onStop,
  onRefresh,
}: {
  turn: AskRun;
  repoUrl: string;
  branch: string;
  onFill?: () => void;
  onStop: () => void;
  onRefresh: () => void;
}) {
  const label = judgmentLabel(turn.judgment);
  return (
    <article className="bb-ask-turn" aria-live="polite">
      <p className="bb-ask-q">
        <span>问</span>
        {turn.question}
      </p>
      {turn.status === "streaming" && turn.statusLine ? <p className="bb-ask-status">{turn.statusLine}</p> : null}
      {turn.answer ? <AnswerText text={turn.answer} repoUrl={repoUrl} branch={branch} /> : null}
      {turn.status === "streaming" && !turn.answer ? <p className="bb-ask-status">正在准备回答</p> : null}
      {label ? <p className={`bb-ask-judge is-${turn.judgment}`}>{label}</p> : null}
      {turn.cached ? (
        <p className="bb-ask-cache">
          沿用上次 · 代码未变
          <button type="button" className="bb-btn bb-btn-ghost" onClick={onRefresh}>
            重新查
          </button>
        </p>
      ) : null}
      {turn.error ? <p className="bb-error">{turn.error}</p> : null}
      <div className="bb-ask-actions">
        {turn.status === "done" && onFill ? (
          <button type="button" className="bb-btn bb-btn-secondary" onClick={onFill}>
            填入报障
          </button>
        ) : null}
        {turn.status === "streaming" ? (
          <button type="button" className="bb-btn bb-btn-ghost" onClick={onStop}>
            停止
          </button>
        ) : null}
      </div>
    </article>
  );
}

function AnswerText({ text, repoUrl, branch }: { text: string; repoUrl: string; branch: string }) {
  return (
    <p className="bb-ask-answer">
      {answerPieces(text, repoUrl, branch).map((piece, index) =>
        piece.href ? (
          <a key={index} className="bb-ask-link" href={piece.href} target="_blank" rel="noreferrer">
            {piece.text}
          </a>
        ) : (
          <span key={index}>{piece.text}</span>
        )
      )}
    </p>
  );
}
