"use client";

import { useCallback, useRef, useState } from "react";

export type PendingFile = {
  id: string;
  file: File;
  previewUrl?: string;
};

type Props = {
  files: PendingFile[];
  onChange: (files: PendingFile[]) => void;
  disabled?: boolean;
  compact?: boolean;
};

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function AttachmentComposer({
  files,
  onChange,
  disabled,
  compact,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const [error, setError] = useState("");

  const addFiles = useCallback(
    (list: FileList | File[]) => {
      const next = [...files];
      for (const file of Array.from(list)) {
        if (file.size > 50 * 1024 * 1024) {
          setError(`「${file.name}」超过 50MB`);
          continue;
        }
        if (next.length >= 20) {
          setError("附件不能超过 20 个");
          break;
        }
        const previewUrl = file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : undefined;
        next.push({ id: uid(), file, previewUrl });
      }
      onChange(next);
    },
    [files, onChange]
  );

  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const pasted: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) pasted.push(f);
        }
      }
      if (pasted.length) {
        e.preventDefault();
        addFiles(pasted);
      }
    },
    [addFiles]
  );

  async function startRecording() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const file = new File([blob], `录音-${Date.now()}.webm`, {
          type: "audio/webm",
        });
        addFiles([file]);
        setRecording(false);
        setRecSeconds(0);
        if (timerRef.current) window.clearInterval(timerRef.current);
      };
      mediaRef.current = recorder;
      recorder.start();
      setRecording(true);
      setRecSeconds(0);
      timerRef.current = window.setInterval(
        () => setRecSeconds((s) => s + 1),
        1000
      );
    } catch {
      setError("无法访问麦克风，请检查浏览器权限");
    }
  }

  function stopRecording() {
    mediaRef.current?.stop();
  }

  function removeFile(id: string) {
    const target = files.find((f) => f.id === id);
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
    onChange(files.filter((f) => f.id !== id));
  }

  return (
    <div onPaste={onPaste}>
      <div
        className={`bb-dropzone${compact ? " is-compact" : ""}`}
        data-active={dragActive}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
        }}
      >
        <div className="bb-drop-row">
          <p className="bb-drop-lead">
            {compact
              ? "拖到这里，或粘贴图片"
              : "拖拽文件到此处，或粘贴图片，也可选择文件 / 录音"}
          </p>
          <div className="bb-drop-actions">
          <button
            type="button"
            className="bb-btn bb-btn-secondary"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            选择文件
          </button>
          {!recording ? (
            <button
              type="button"
              className="bb-btn bb-btn-secondary"
              disabled={disabled}
              onClick={startRecording}
            >
              录音
            </button>
          ) : (
            <button
              type="button"
              className="bb-btn bb-btn-danger"
              onClick={stopRecording}
            >
              停止录音（{recSeconds}s）
            </button>
          )}
          </div>
        </div>
        <p className="bb-drop-hint">
          单文件 ≤ 50MB，最多 20 个；支持图 / 视频 / 文档 / 音频
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {error ? <p className="bb-error">{error}</p> : null}
      {files.length > 0 ? (
        <ul style={{ listStyle: "none", padding: 0, margin: "0.75rem 0 0" }}>
          {files.map((f) => (
            <li
              key={f.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                padding: "0.4rem 0",
                borderBottom: "1px solid var(--line)",
              }}
            >
              {f.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={f.previewUrl}
                  alt=""
                  width={40}
                  height={40}
                  style={{ objectFit: "cover", borderRadius: 6 }}
                />
              ) : (
                <span className="bb-muted" style={{ width: 40, textAlign: "center" }}>
                  文件
                </span>
              )}
              <span style={{ flex: 1 }}>
                {f.file.name}{" "}
                <span className="bb-muted">
                  ({Math.round(f.file.size / 1024)} KB)
                </span>
              </span>
              <button
                type="button"
                className="bb-btn bb-btn-ghost"
                onClick={() => removeFile(f.id)}
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
