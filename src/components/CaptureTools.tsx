"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Annotator } from "./Annotator";
import { speechSupported, startLiveSpeech } from "./live-speech";
import type { Stroke } from "@/lib/strokes";
import type { Segment } from "@/lib/transcript";

const VIDEO_CAP = 48 * 1024 * 1024;

type Speech = { stop: () => void };

export function CaptureTools({
  projectId,
  onSnap,
  onVoice,
}: {
  projectId: number;
  onSnap: (item: { file: File; note: string; strokes: Stroke[] }) => void;
  onVoice: (item: { file: File; text: string }) => void;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [partial, setPartial] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [recording, setRecording] = useState<"voice" | "walk" | null>(null);
  const [paused, setPaused] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [busy, setBusy] = useState(false);
  const speechRef = useRef<Speech | null>(null);
  const finalsRef = useRef("");
  const noteDirty = useRef(false);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const bytesRef = useRef(0);
  const streamsRef = useRef<MediaStream[]>([]);
  const audioRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const meterRef = useRef<number | null>(null);
  const segmentsRef = useRef<Segment[]>([]);
  const segmentStart = useRef(0);
  const startedAt = useRef(0);
  const pausedMs = useRef(0);
  const pauseBegan = useRef(0);
  const shotsRef = useRef<{ t: number; note: string; strokes: Stroke[]; file: File }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      stopSpeech();
      stopMeter();
      if (timerRef.current) window.clearInterval(timerRef.current);
      streamsRef.current.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
      void audioRef.current?.close();
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
    // 卸载时释放设备。imageUrl 的撤销在更换图片时单独处理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopSpeech() {
    speechRef.current?.stop();
    speechRef.current = null;
    setSpeaking(false);
    setPartial("");
  }

  function stopMeter() {
    if (meterRef.current) window.cancelAnimationFrame(meterRef.current);
    meterRef.current = null;
  }

  function elapsed() {
    const pausedExtra = pauseBegan.current ? performance.now() - pauseBegan.current : 0;
    return Math.max(0, (performance.now() - startedAt.current - pausedMs.current - pausedExtra) / 1000);
  }

  function beginSpeech(onFinalExtra?: (text: string, at: number) => void) {
    finalsRef.current = "";
    const handle = startLiveSpeech({
      onPartial: setPartial,
      onFinal: (text) => {
        if (!text) return;
        finalsRef.current = `${finalsRef.current} ${text}`.trim();
        if (!noteDirty.current) setNote(finalsRef.current);
        onFinalExtra?.(text, elapsed());
        setPartial("");
      },
      onEnd: () => setSpeaking(false),
    });
    if (!handle) {
      setError(speechSupported() ? "语音识别没有启动" : "这个浏览器没有实时语音识别，仍可以录音后改字");
      return;
    }
    speechRef.current = handle;
    setSpeaking(true);
  }

  function openImage(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("请选择图片");
      return;
    }
    setError("");
    noteDirty.current = false;
    finalsRef.current = "";
    setNote("");
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageUrl(URL.createObjectURL(file));
  }

  async function shareFrame() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const video = document.createElement("video");
      video.srcObject = stream;
      await video.play();
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      canvas.getContext("2d")?.drawImage(video, 0, 0);
      stream.getTracks().forEach((track) => track.stop());
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("没有截到画面");
      openImage(new File([blob], "共享画面.png", { type: "image/png" }));
    } catch {
      setError("没有共享到画面");
    }
  }

  async function finishVoice(blob: Blob) {
    const browserText = finalsRef.current.trim();
    let text = browserText;
    try {
      const form = new FormData();
      form.set("file", new File([blob], "录音.webm", { type: blob.type || "audio/webm" }));
      const res = await fetch(`/api/projects/${projectId}/transcribe`, { method: "POST", body: form });
      const data = (await res.json()) as { available?: boolean; text?: string };
      if (data.available && data.text && !noteDirty.current) text = data.text.trim();
    } catch {
      // 浏览器里已经识别到的文字继续用
    }
    onVoice({
      file: new File([blob], `录音-${Date.now()}.webm`, { type: blob.type || "audio/webm" }),
      text,
    });
  }

  async function recordVoice() {
    setError("");
    if (mediaRef.current) {
      mediaRef.current.stop();
      stopSpeech();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamsRef.current = [stream];
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        mediaRef.current = null;
        setRecording(null);
        void finishVoice(blob);
      };
      mediaRef.current = recorder;
      recorder.start();
      setRecording("voice");
      noteDirty.current = false;
      beginSpeech();
    } catch {
      setError("无法访问麦克风");
    }
  }

  async function startWalk() {
    setError("");
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: true,
      });
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamsRef.current = [display, mic];
      const audio = new AudioContext();
      audioRef.current = audio;
      const dest = audio.createMediaStreamDestination();
      const displayAudio = display.getAudioTracks()[0];
      if (displayAudio) audio.createMediaStreamSource(new MediaStream([displayAudio])).connect(dest);
      const micSource = audio.createMediaStreamSource(mic);
      micSource.connect(dest);
      const analyser = audio.createAnalyser();
      micSource.connect(analyser);
      analyser.fftSize = 256;
      const mixed = new MediaStream([
        ...display.getVideoTracks(),
        ...dest.stream.getAudioTracks(),
      ]);
      const recorder = new MediaRecorder(mixed);
      chunksRef.current = [];
      bytesRef.current = 0;
      shotsRef.current = [];
      segmentsRef.current = [];
      recorder.ondataavailable = (event) => {
        if (!event.data.size) return;
        chunksRef.current.push(event.data);
        bytesRef.current += event.data.size;
        if (bytesRef.current >= VIDEO_CAP) void finishWalk(true);
      };
      mediaRef.current = recorder;
      startedAt.current = performance.now();
      pausedMs.current = 0;
      pauseBegan.current = 0;
      segmentStart.current = 0;
      recorder.start(1000);
      setRecording("walk");
      setPaused(false);
      setSeconds(0);
      timerRef.current = window.setInterval(() => setSeconds(Math.floor(elapsed())), 500);
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const value of data) {
          const centered = (value - 128) / 128;
          sum += centered * centered;
        }
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
        meterRef.current = window.requestAnimationFrame(tick);
      };
      tick();
      noteDirty.current = false;
      beginSpeech((text, at) => {
        segmentsRef.current.push({ start: segmentStart.current, end: at, text });
        segmentStart.current = at;
      });
      display.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (mediaRef.current?.state === "recording") void finishWalk(false);
      });
    } catch {
      setError("没有开始录屏");
    }
  }

  function togglePause() {
    const recorder = mediaRef.current;
    if (!recorder) return;
    if (recorder.state === "recording") {
      recorder.pause();
      pauseBegan.current = performance.now();
      setPaused(true);
      return;
    }
    if (recorder.state === "paused") {
      pausedMs.current += performance.now() - pauseBegan.current;
      pauseBegan.current = 0;
      recorder.resume();
      setPaused(false);
    }
  }

  async function snapWhileRecording() {
    const display = streamsRef.current[0];
    const track = display?.getVideoTracks()[0];
    if (!track) return;
    const video = document.createElement("video");
    video.srcObject = new MediaStream([track]);
    await video.play();
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return;
    openImage(new File([blob], `走查-${shotsRef.current.length + 1}.png`, { type: "image/png" }));
  }

  async function finishWalk(truncated: boolean) {
    const recorder = mediaRef.current;
    if (!recorder || busy) return;
    setBusy(true);
    stopSpeech();
    stopMeter();
    if (timerRef.current) window.clearInterval(timerRef.current);
    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        resolve(new Blob(chunksRef.current, { type: recorder.mimeType || "video/webm" }));
      };
      if (recorder.state !== "inactive") recorder.stop();
      else resolve(new Blob(chunksRef.current, { type: "video/webm" }));
    });
    streamsRef.current.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
    void audioRef.current?.close();
    mediaRef.current = null;
    setRecording(null);
    const form = new FormData();
    form.set("transcript", JSON.stringify(segmentsRef.current));
    form.set("durationSec", String(elapsed()));
    form.set("truncated", truncated || blob.size >= VIDEO_CAP ? "1" : "0");
    if (blob.size && blob.size <= 50 * 1024 * 1024) {
      form.set("video", new File([blob], "走查.webm", { type: blob.type || "video/webm" }));
    }
    form.set(
      "frames",
      JSON.stringify(
        shotsRef.current.map((shot) => ({ t: shot.t, note: shot.note, strokes: shot.strokes }))
      )
    );
    shotsRef.current.forEach((shot, index) => form.set(`frame-${index}`, shot.file));
    const res = await fetch(`/api/projects/${projectId}/captures`, { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError((data as { error?: string }).error || "走查没有保存");
      return;
    }
    const sessionId = (data as { session?: { id: number } }).session?.id;
    if (sessionId) router.push(`/projects/${projectId}/captures/${sessionId}`);
  }

  return (
    <div className="bb-cap-tools">
      <div className="bb-label">取证</div>
      <div className="bb-cap-row">
        <button type="button" className="bb-btn bb-btn-ghost" onClick={() => void shareFrame()} disabled={recording === "walk"}>
          共享画面
        </button>
        <button type="button" className="bb-btn bb-btn-ghost" onClick={() => fileRef.current?.click()} disabled={recording === "walk"}>
          选择图片
        </button>
        <button type="button" className="bb-btn bb-btn-ghost" onClick={() => cameraRef.current?.click()} disabled={recording === "walk"}>
          拍照
        </button>
        <button type="button" className="bb-btn bb-btn-ghost" onClick={() => void recordVoice()} disabled={recording === "walk"}>
          {recording === "voice" ? "停止并填入" : "说一句"}
        </button>
        <button type="button" className="bb-btn bb-btn-ghost" onClick={() => void startWalk()} disabled={recording !== null}>
          录一段走查
        </button>
      </div>
      <p className="bb-field-hint">圈图和语音会写进这张单。走查会拆成草稿，看完才入库。</p>
      {error ? <p className="bb-error">{error}</p> : null}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) openImage(file);
          event.target.value = "";
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) openImage(file);
          event.target.value = "";
        }}
      />
      {imageUrl ? (
        <Annotator
          imageUrl={imageUrl}
          note={note}
          partial={partial}
          speaking={speaking}
          onNote={(value) => {
            noteDirty.current = true;
            setNote(value);
          }}
          onSpeak={() => (speaking ? stopSpeech() : beginSpeech())}
          onCancel={() => {
            stopSpeech();
            URL.revokeObjectURL(imageUrl);
            setImageUrl(null);
          }}
          onDone={(file, strokes) => {
            const duringWalk = Boolean(mediaRef.current);
            if (duringWalk) {
              shotsRef.current.push({ t: elapsed(), note, strokes, file });
            } else {
              onSnap({ file, note, strokes });
            }
            stopSpeech();
            URL.revokeObjectURL(imageUrl);
            setImageUrl(null);
            setNote("");
            noteDirty.current = false;
          }}
        />
      ) : null}
      {recording === "walk" ? (
        <div className="bb-cap-bar" role="status">
          <span className={`bb-cap-dot${paused ? " is-paused" : ""}`} />
          <strong>{formatClock(seconds)}</strong>
          <span className="bb-cap-meter" aria-hidden>
            <span style={{ width: `${Math.round(level * 100)}%` }} />
          </span>
          <button type="button" className="bb-btn bb-btn-ghost" onClick={togglePause}>
            {paused ? "继续" : "暂停"}
          </button>
          <button type="button" className="bb-btn bb-btn-ghost" onClick={() => void snapWhileRecording()}>
            截一张
          </button>
          <button type="button" className="bb-btn" onClick={() => void finishWalk(false)} disabled={busy}>
            {busy ? "整理中…" : "完成"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function formatClock(total: number) {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
