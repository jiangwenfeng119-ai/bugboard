"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { ImageLightbox } from "@/components/ImageLightbox";

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
  /** Replaces the built-in 选择文件 / 录音 row. Receives the opener for the hidden file input. */
  toolbar?: (openFiles: () => void) => ReactNode;
  lead?: string;
  hint?: string;
};

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function AttachmentComposer({
  files,
  onChange,
  disabled,
  compact,
  toolbar,
  lead,
  hint,
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
      const pasted: File[] = [];
      const items = e.clipboardData?.items;
      if (items) {
        for (const item of Array.from(items)) {
          if (item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (file) pasted.push(file);
          }
        }
      }
      if (!pasted.length && e.clipboardData?.files?.length) {
        for (const file of Array.from(e.clipboardData.files)) {
          if (file.type.startsWith("image/")) pasted.push(file);
        }
      }
      if (!pasted.length) return;
      e.preventDefault();
      e.stopPropagation();
      addFiles(pasted);
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

  const leadText =
    lead ??
    (compact ? "拖到这里，或粘贴图片" : "拖拽文件到此处，或粘贴图片，也可选择文件 / 录音");
  const hintText =
    hint ?? (toolbar ? "" : "单文件 ≤ 50MB，最多 20 个；支持图 / 视频 / 文档 / 音频");

  return (
    <div onPaste={onPaste} data-paste-files="">
      <div
        className={`bb-dropzone${compact ? " is-compact" : ""}${toolbar ? " has-toolbar" : ""}`}
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
        {toolbar ? (
          <>
            <p className="bb-drop-lead">{leadText}</p>
            {toolbar(() => inputRef.current?.click())}
          </>
        ) : (
          <div className="bb-drop-row">
            <p className="bb-drop-lead">{leadText}</p>
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
                <button type="button" className="bb-btn bb-btn-danger" onClick={stopRecording}>
                  停止录音（{recSeconds}s）
                </button>
              )}
            </div>
          </div>
        )}
        {hintText ? <p className="bb-drop-hint">{hintText}</p> : null}
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
        <ul className="bb-file-list">
          {files.map((f) => (
            <li key={f.id} className="bb-file-row">
              {f.previewUrl ? (
                <ImageLightbox
                  src={f.previewUrl}
                  alt={f.file.name}
                  className="bb-file-thumb"
                  width={40}
                  height={40}
                />
              ) : (
                <span className="bb-file-kind">文件</span>
              )}
              <span className="bb-file-name">
                {f.file.name}{" "}
                <span className="bb-muted">({Math.round(f.file.size / 1024)} KB)</span>
              </span>
              <button type="button" className="bb-btn bb-btn-ghost" onClick={() => removeFile(f.id)}>
                移除
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
