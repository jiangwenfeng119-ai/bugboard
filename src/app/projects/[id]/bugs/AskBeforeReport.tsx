"use client";

import { useEffect, useId, useRef, useState } from "react";
import { bugBodyUntouched } from "@/lib/bug-body";
import { answerPieces, fillBugDraft, judgmentLabel, type AskJudgment, type AskStatus } from "@/lib/ask-core";
import type { Priority } from "@/lib/types";
import { filesFromClipboard, pickAskPictures } from "@/lib/ask-paste";
import { joinAskSpeech, speechSupported, startLiveSpeech } from "@/components/live-speech";
import type { PendingFile } from "@/components/AttachmentComposer";
import { ImageLightbox } from "@/components/ImageLightbox";

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
  onFill?: (next: { title: string; body: string; priority?: Priority | ""; attachment?: string }) => void;
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
  const [pasted, setPasted] = useState<PendingFile[]>([]);
  const pastedRef = useRef(pasted);
  pastedRef.current = pasted;
  const speechRef = useRef<ReturnType<typeof startLiveSpeech>>(null);
  const speechBaseRef = useRef("");
  const speechPartialRef = useRef("");
  const hearingRef = useRef(false);
  const liveId = [...turns].reverse().find((turn) => turn.status === "streaming")?.id ?? 0;

  useEffect(() => {
    return () => {
      for (const item of pastedRef.current) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
      try {
        speechRef.current?.stop();
      } catch {
        // 已停过
      }
      speechRef.current = null;
      hearingRef.current = false;
    };
  }, []);

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

  const streaming = liveId !== 0;

  function showSpeech(base: string, partial: string) {
    setQuestion(joinAskSpeech(base, partial));
  }

  function commitSpeechPartial() {
    const partial = speechPartialRef.current.trim();
    speechPartialRef.current = "";
    if (!partial) return;
    speechBaseRef.current = joinAskSpeech(speechBaseRef.current, partial);
    showSpeech(speechBaseRef.current, "");
  }

  function stopHearing() {
    const handle = speechRef.current;
    speechRef.current = null;
    hearingRef.current = false;
    commitSpeechPartial();
    setHearing(false);
    if (!handle) return;
    try {
      handle.stop();
    } catch {
      // 浏览器已结束识别
    }
  }

  function startHearing() {
    if (hearingRef.current || sending || streaming) return;
    speechBaseRef.current = question;
    speechPartialRef.current = "";
    const handle = startLiveSpeech({
      onPartial: (text) => {
        if (!hearingRef.current) return;
        // 停顿时 interim 会变空；把上一句未定稿的字先留下，避免输入框被清空
        if (!text) {
          commitSpeechPartial();
          return;
        }
        speechPartialRef.current = text;
        showSpeech(speechBaseRef.current, text);
      },
      onFinal: (text) => {
        if (!hearingRef.current) return;
        speechPartialRef.current = "";
        if (!text) {
          showSpeech(speechBaseRef.current, "");
          return;
        }
        speechBaseRef.current = joinAskSpeech(speechBaseRef.current, text);
        showSpeech(speechBaseRef.current, "");
      },
      onEnd: () => {
        if (!hearingRef.current) return;
        speechRef.current = null;
        hearingRef.current = false;
        commitSpeechPartial();
        setHearing(false);
      },
    });
    if (!handle) {
      setFormError("没有启动口述。请允许麦克风后重试，或直接打字。");
      return;
    }
    speechRef.current = handle;
    hearingRef.current = true;
    setHearing(true);
    setFormError("");
  }

  async function ask(text: string, force: boolean) {
    const clean = text.trim();
    if (!clean || sending) return;
    if (hearingRef.current) stopHearing();
    setSending(true);
    setFormError("");
    setHint("");
    try {
      const draft = [title.trim(), bugBodyUntouched(body) ? "" : body.trim()].filter(Boolean).join("\n\n").slice(0, 2000);
      const { chosen, dropped } = pickAskPictures(pasted, files);
      if (dropped) setHint("有的图片太大或超过 4 张，这次没带上。");
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
      if (!force) {
        setQuestion("");
        speechBaseRef.current = "";
        speechPartialRef.current = "";
      }
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

  function onPaste(event: React.ClipboardEvent) {
    if (sending || streaming) return;
    const found = filesFromClipboard(event.clipboardData, pasted.length);
    if (!found.files.length && !found.skipped) return;
    event.preventDefault();
    if (found.skipped) setHint("有的图片太大、格式不对，或已经超过 4 张，这次没带上。");
    else setHint("");
    if (!found.files.length) return;
    const text = event.clipboardData.getData("text/plain");
    if (text && event.target instanceof HTMLTextAreaElement) {
      const start = event.target.selectionStart ?? question.length;
      const end = event.target.selectionEnd ?? question.length;
      setQuestion((current) => `${current.slice(0, start)}${text}${current.slice(end)}`.slice(0, 2000));
    }
    setPasted((prev) => [
      ...prev,
      ...found.files.map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ]);
  }

  function removePasted(id: string) {
    setPasted((prev) => {
      const item = prev.find((entry) => entry.id === id);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((entry) => entry.id !== id);
    });
  }

  function fill(run: AskRun) {
    if (!onFill) return;
    const next = fillBugDraft({
      question: run.question,
      answer: run.answer,
      title,
      body,
      bodyUntouched: bugBodyUntouched(body),
    });
    onFill(next);
    const rank = next.priority ? next.priority.toUpperCase() : "";
    const head = rank
      ? `已写入标题、描述，优先级选了 ${rank}。提交前请改一改。`
      : "已整理进下方标题和描述，提交前请改一改。";
    setHint(next.attachment ? `${head}附件：${next.attachment}` : head);
  }

  return (
    <section className="bb-ask" aria-labelledby={labelId}>
      <div className="bb-ask-head">
        <h3 id={labelId}>问问项目助理</h3>
        <p>先确认现在能不能做。只回答，不改代码，也不替你提交。</p>
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

      <div className="bb-ask-form" onPaste={onPaste}>
        <label className="bb-label" htmlFor={`${labelId}-q`}>
          问题
        </label>
        <textarea
          id={`${labelId}-q`}
          className="bb-textarea bb-ask-input"
          value={question}
          maxLength={2000}
          rows={1}
          placeholder="例如：会员积分的入口在哪里？"
          disabled={sending || streaming}
          aria-describedby={hearing ? `${labelId}-hearing` : undefined}
          onChange={(event) => {
            const next = event.target.value;
            if (hearingRef.current) {
              speechBaseRef.current = next;
              speechPartialRef.current = "";
            }
            setQuestion(next);
          }}
          onKeyDown={(event) => {
            // IME 组合中（中文等输入法选词/确认）的 Enter 不能当成发送
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              event.keyCode !== 229
            ) {
              event.preventDefault();
              void ask(question, false);
            }
          }}
        />
        {pasted.length ? (
          <ul className="bb-ask-shots">
            {pasted.map((item, index) => (
              <li key={item.id} className="bb-ask-shot">
                <ImageLightbox
                  src={item.previewUrl}
                  alt={`已贴上的截图 ${index + 1}`}
                  className="bb-ask-shot-img"
                />
                <button type="button" onClick={() => removePasted(item.id)}>
                  去掉
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {pasted.length ? <p className="bb-ask-hint">这些图会随提问送出。不需要时点去掉。</p> : null}
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
              aria-pressed={hearing}
              onClick={() => {
                if (hearingRef.current) stopHearing();
                else startHearing();
              }}
            >
              {hearing ? "停止听写" : "口述问题"}
            </button>
          ) : null}
          <p id={hearing ? `${labelId}-hearing` : undefined} className="bb-field-hint">
            {hearing ? "正在听。说完后点「停止听写」或「提问」。" : "Enter 发送，Shift+Enter 换行。这个问题里也可以贴截图，最多 4 张。"}
          </p>
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
        <p className="bb-ask-status">写进下方标题、描述和优先级，不直接提交。</p>
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
