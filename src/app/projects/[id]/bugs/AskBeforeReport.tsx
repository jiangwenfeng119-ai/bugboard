"use client";

import { useEffect, useId, useRef, useState } from "react";
import { bugBodyUntouched } from "@/lib/bug-body";
import { answerPieces, ASK_IMAGE_MAX_BYTES, ASK_IMAGE_MAX_COUNT, fillBugDraft, judgmentLabel, type AskJudgment, type AskStatus } from "@/lib/ask-core";
import { speechSupported, startLiveSpeech } from "@/components/live-speech";
import type { PendingFile } from "@/components/AttachmentComposer";

function askForm(input: {
  question: string;
  threadId: string;
  force: boolean;
  draft: string;
  files: PendingFile[];
  imageIds: number[];
}) {
  const form = new FormData();
  form.set("question", input.question);
  form.set("threadId", input.threadId);
  form.set("force", input.force ? "1" : "");
  form.set("draft", input.draft);
  form.set("attachmentIds", input.imageIds.join(","));
  for (const item of input.files) form.append("image", item.file, item.file.name);
  return form;
}

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
  files = [],
  imageIds = [],
}: {
  projectId: number;
  title: string;
  body: string;
  repoUrl?: string;
  branch?: string;
  seed?: string;
  onFill?: (next: { title: string; body: string }) => void;
  files?: PendingFile[];
  imageIds?: number[];
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
      const draft = [title.trim(), bugBodyUntouched(body) ? "" : body.trim()].filter(Boolean).join("\n\n").slice(0, 2000);
      const pictures = files.filter((item) => item.file.type.startsWith("image/"));
      const chosen = pictures.filter((item) => item.file.size <= ASK_IMAGE_MAX_BYTES).slice(0, ASK_IMAGE_MAX_COUNT);
      if (pictures.length > chosen.length) setHint("有的图片太大或超过 4 张，这次没带上。");
      const res = await fetch(
        `/api/projects/${projectId}/ask`,
        chosen.length
          ? {
              method: "POST",
              body: askForm({ question: clean, threadId, force, draft, files: chosen, imageIds }),
            }
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ question: clean, threadId, force, draft, attachmentIds: imageIds }),
            }
      );
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
    setHint("已整理进下方标题和描述，提交前请改一改");
  }

  const streaming = liveId !== 0;

  return (
    <section className="bb-ask" aria-labelledby={labelId}>
      <div className="bb-ask-head">
        <h3 id={labelId}>问问项目助理</h3>
        <p>问入口时马上回答在哪个菜单。带了截图，或写的是故障，会在项目镜像里对照代码后再答。只回答，不改代码，也不替你提交。</p>
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
      {turn.status === "streaming" && !turn.answer ? (
        <WaitingLine text={turn.statusLine || "正在准备回答"} />
      ) : null}
      {turn.status === "streaming" && turn.answer && turn.statusLine ? (
        <p className="bb-ask-status">{turn.statusLine}</p>
      ) : null}
      {turn.answer ? <AnswerText text={turn.answer} repoUrl={repoUrl} branch={branch} /> : null}
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
          <button
            type="button"
            className={turn.judgment === "file" || turn.judgment === "unsure" ? "bb-btn" : "bb-btn bb-btn-secondary"}
            onClick={onFill}
          >
            {turn.judgment === "exists" ? "仍要填入报障" : "整理并填入报障"}
          </button>
        ) : null}
        {turn.status === "streaming" ? (
          <button type="button" className="bb-btn bb-btn-ghost" onClick={onStop}>
            停止
          </button>
        ) : null}
      </div>
      {turn.status === "streaming" && onFill ? (
        <p className="bb-ask-status">答完后，建议报障或没有把握时，这里会出现「整理并填入报障」。</p>
      ) : null}
      {turn.status === "done" && onFill && turn.judgment !== "exists" ? (
        <p className="bb-ask-status">写进下方标题和描述，不直接提交。</p>
      ) : null}
    </article>
  );
}

function WaitingLine({ text }: { text: string }) {
  const started = useRef(Date.now());
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - started.current) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <p className="bb-ask-status bb-ask-wait">
      <span className="bb-ask-ink" aria-hidden="true" />
      <span className="bb-ask-wait-text">{text}</span>
      {seconds > 0 ? (
        <span className="bb-ask-wait-time" aria-hidden="true">
          {seconds} 秒
        </span>
      ) : null}
    </p>
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
