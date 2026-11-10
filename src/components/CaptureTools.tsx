"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Annotator } from "./Annotator";
import { speechSupported, startLiveSpeech } from "./live-speech";
import type { Stroke } from "@/lib/strokes";
import type { Segment } from "@/lib/transcript";

const VIDEO_CAP = 48 * 1024 * 1024;

type Speech = { stop: () => void };
type SpeechMode = "voice" | "walk" | "note";

export function CaptureTools({
  projectId,
  draftPending,
  onSnap,
  onVoice,
}: {
  projectId: number;
  draftPending: boolean;
  onSnap: (item: { file: File; note: string; strokes: Stroke[] }) => void;
  onVoice: (item: { file: File; text: string }) => void;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [landed, setLanded] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [partial, setPartial] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [recording, setRecording] = useState<"voice" | "walk" | null>(null);
  const [paused, setPaused] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState(false);
  const [heard, setHeard] = useState(false);
  const [speechNote, setSpeechNote] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [said, setSaid] = useState<string[]>([]);
  const [marks, setMarks] = useState(0);
  const speechRef = useRef<Speech | null>(null);
  const speechStop = useRef(false);
  const finalsRef = useRef("");
  const partialRef = useRef("");
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
  const pendingRef = useRef<FormData | null>(null);
  const busyRef = useRef(false);
  const markingRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      stopSpeech();
      stopMeter();
      stopClock();
      streamsRef.current.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
      void audioRef.current?.close();
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
    // 卸载时释放设备。imageUrl 的撤销在更换图片时单独处理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopSpeech() {
    speechStop.current = true;
    speechRef.current?.stop();
    speechRef.current = null;
    setSpeaking(false);
    partialRef.current = "";
    setPartial("");
  }

  function stopMeter() {
    if (meterRef.current) window.cancelAnimationFrame(meterRef.current);
    meterRef.current = null;
  }

  function stopClock() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
  }

  function startClock() {
    startedAt.current = performance.now();
    pausedMs.current = 0;
    pauseBegan.current = 0;
    setSeconds(0);
    stopClock();
    timerRef.current = window.setInterval(() => setSeconds(Math.floor(elapsed())), 500);
  }

  function elapsed() {
    const pausedExtra = pauseBegan.current ? performance.now() - pauseBegan.current : 0;
    return Math.max(0, (performance.now() - startedAt.current - pausedMs.current - pausedExtra) / 1000);
  }

  function releaseStreams() {
    streamsRef.current.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
    streamsRef.current = [];
    void audioRef.current?.close();
    audioRef.current = null;
  }

  function consumePartial() {
    const text = partialRef.current.trim();
    partialRef.current = "";
    setPartial("");
    if (!text || finalsRef.current.endsWith(text)) return;
    const at = elapsed();
    segmentsRef.current.push({ start: segmentStart.current, end: at, text });
    segmentStart.current = at;
    finalsRef.current = `${finalsRef.current} ${text}`.trim();
    if (!noteDirty.current) setNote(finalsRef.current);
    setHeard(true);
  }

  function beginSpeech(mode: SpeechMode, onFinalExtra?: (text: string, at: number) => void) {
    finalsRef.current = "";
    partialRef.current = "";
    speechStop.current = false;
    const handle = startLiveSpeech({
      onPartial: (text) => {
        partialRef.current = text;
        setPartial(text);
        if (text) setHeard(true);
      },
      onFinal: (text) => {
        partialRef.current = "";
        if (!text) return;
        const duplicate = finalsRef.current.endsWith(text);
        if (!duplicate) {
          finalsRef.current = `${finalsRef.current} ${text}`.trim();
          onFinalExtra?.(text, elapsed());
          setSaid((prev) => [...prev, text].slice(-2));
        }
        if (!noteDirty.current && !markingRef.current) setNote(finalsRef.current);
        setPartial("");
        setHeard(true);
      },
      onEnd: () => {
        setSpeaking(false);
        if (!speechStop.current && mode === "walk" && mediaRef.current) {
          setSpeechNote("语音识别停了，录像仍会留下。");
        }
      },
    });
    if (!handle) {
      if (mode === "walk") {
        setSpeechNote(
          speechSupported()
            ? "语音识别没有启动，录像仍会留下，完成后可以自己写。"
            : "这个浏览器不会边录边转写，完成后可以自己写。"
        );
      } else {
        setError(
          speechSupported()
            ? "语音识别没有启动。仍可以录音，停下来后自己改字。"
            : "这个浏览器没有实时语音识别。仍可以录音，停下来后自己改字。"
        );
      }
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
    setLanded("");
    const duringWalk = mediaRef.current != null && mediaRef.current.state !== "inactive";
    if (!duringWalk) {
      noteDirty.current = false;
      finalsRef.current = "";
    }
    markingRef.current = duringWalk;
    setNote("");
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageUrl(URL.createObjectURL(file));
  }

  async function shareFrame() {
    setError("");
    setLanded("");
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
    } catch (caught) {
      if (pickerCancelled(caught)) return;
      setError("没有共享到画面。再选一次窗口。");
    }
  }

  async function finishVoice(blob: Blob) {
    consumePartial();
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
    setLanded(
      text
        ? `已写入这张单：${text}`
        : "录音已放进附件。没有识别到文字，写在描述里即可。"
    );
  }

  async function recordVoice() {
    setError("");
    setLanded("");
    if (mediaRef.current) {
      consumePartial();
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
        stopClock();
        void finishVoice(blob);
      };
      mediaRef.current = recorder;
      recorder.start();
      setRecording("voice");
      noteDirty.current = false;
      startClock();
      beginSpeech("voice");
    } catch {
      releaseStreams();
      setError("无法访问麦克风。允许麦克风后再说。");
    }
  }

  function requestWalk() {
    setError("");
    setLanded("");
    if (draftPending) {
      setConfirmLeave(true);
      return;
    }
    void startWalk();
  }

  async function startWalk() {
    setError("");
    setLanded("");
    setConfirmLeave(false);
    setSpeechNote("");
    setHeard(false);
    setHeld(false);
    pendingRef.current = null;
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: true,
      });
      streamsRef.current = [display];
      let mic: MediaStream;
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        display.getTracks().forEach((track) => track.stop());
        streamsRef.current = [];
        setError("无法访问麦克风。允许麦克风后再录。");
        return;
      }
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
      const mixed = new MediaStream([...display.getVideoTracks(), ...dest.stream.getAudioTracks()]);
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
      segmentStart.current = 0;
      recorder.start(1000);
      setRecording("walk");
      setPaused(false);
      setSaid([]);
      setMarks(0);
      startClock();
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
      beginSpeech("walk", (text, at) => {
        segmentsRef.current.push({ start: segmentStart.current, end: at, text });
        segmentStart.current = at;
      });
      display.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (mediaRef.current?.state === "recording") void finishWalk(false);
      });
    } catch (caught) {
      releaseStreams();
      mediaRef.current = null;
      if (pickerCancelled(caught)) return;
      setError("没有开始录屏。再选一次要共享的画面。");
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
    try {
      await video.play();
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      canvas.getContext("2d")?.drawImage(video, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) return;
      openImage(new File([blob], `走查-${shotsRef.current.length + 1}.png`, { type: "image/png" }));
    } finally {
      video.pause();
      video.srcObject = null;
    }
  }

  async function finishWalk(truncated: boolean) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      if (!pendingRef.current) {
        const recorder = mediaRef.current;
        if (!recorder) return;
        consumePartial();
        stopSpeech();
        stopMeter();
        stopClock();
        const blob = await new Promise<Blob>((resolve) => {
          recorder.onstop = () => {
            resolve(new Blob(chunksRef.current, { type: recorder.mimeType || "video/webm" }));
          };
          if (recorder.state !== "inactive") recorder.stop();
          else resolve(new Blob(chunksRef.current, { type: "video/webm" }));
        });
        releaseStreams();
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
          JSON.stringify(shotsRef.current.map((shot) => ({ t: shot.t, note: shot.note, strokes: shot.strokes })))
        );
        shotsRef.current.forEach((shot, index) => form.set(`frame-${index}`, shot.file));
        pendingRef.current = form;
      }
      const res = await fetch(`/api/projects/${projectId}/captures`, {
        method: "POST",
        body: pendingRef.current,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = (data as { error?: string }).error || "走查没有保存";
        if (res.status >= 500) {
          setHeld(true);
          setError(`${message}。录像还在，可以再保存一次。`);
          return;
        }
        pendingRef.current = null;
        setHeld(false);
        setError(message === "走查是空的" ? "这段是空的，没有留下。说一句或截一张后再录一次。" : message);
        return;
      }
      pendingRef.current = null;
      setHeld(false);
      const sessionId = (data as { session?: { id: number } }).session?.id;
      if (sessionId) router.push(`/projects/${projectId}/captures/${sessionId}`);
    } catch {
      setHeld(true);
      setError("网络异常，录像还在。再保存一次。");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const hearing = speechNote || (heard || partial ? partial || "正在听写" : "还没听到话。截一张也会留下。");

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
        <button
          type="button"
          className="bb-btn bb-btn-ghost"
          onClick={() => void recordVoice()}
          disabled={recording === "walk"}
          aria-pressed={recording === "voice"}
        >
          {recording === "voice" ? "停止" : "说一句"}
        </button>
      </div>
      <p className="bb-field-hint">圈图和语音写进这张单。</p>
      {recording === "voice" ? (
        <p className="bb-cap-status" role="status">
          正在听 {formatClock(seconds)}。停止后写入这张单。
        </p>
      ) : null}
      {landed ? <p className="bb-success">{landed}</p> : null}
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
          onSpeak={() => (speaking ? stopSpeech() : beginSpeech("note"))}
          autoTake={recording === "walk"}
          onCancel={() => {
            markingRef.current = false;
            if (recording !== "walk") stopSpeech();
            URL.revokeObjectURL(imageUrl);
            setImageUrl(null);
            setNote("");
          }}
          onDone={(file, strokes) => {
            const duringWalk = Boolean(mediaRef.current);
            markingRef.current = false;
            if (duringWalk) {
              shotsRef.current.push({ t: elapsed(), note, strokes, file });
              setMarks((count) => count + 1);
            } else {
              onSnap({ file, note, strokes });
              setLanded(note.trim() ? `已写入这张单：${note.trim()}` : "这张图已放进附件。");
            }
            if (!duringWalk) stopSpeech();
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
          <div className="bb-cap-heard">
            {said.map((line, index) => (
              <p key={`${index}-${line}`}>{line}</p>
            ))}
            {partial ? <p className="is-live">{partial}</p> : null}
            {!said.length && !partial ? <p className="is-live">{hearing}</p> : null}
            <p className="bb-field-hint">说「不对，是……」会改刚才那句。圈一下收下这一帧，录屏不停。</p>
          </div>
          <button type="button" className="bb-btn bb-btn-ghost" onClick={togglePause}>
            {paused ? "继续" : "暂停"}
          </button>
          <button type="button" className="bb-btn bb-btn-ghost" onClick={() => void snapWhileRecording()} disabled={Boolean(imageUrl)}>
            {marks ? `圈一下 · ${marks}` : "圈一下"}
          </button>
          <button type="button" className="bb-btn" onClick={() => void finishWalk(false)} disabled={busy}>
            {busy ? "整理中…" : "完成"}
          </button>
        </div>
      ) : held ? (
        <div className="bb-cap-walk">
          <p className="bb-field-hint">录像还在这页上，保存成功后才会去整理草稿。</p>
          <div className="bb-cap-actions">
            <button type="button" className="bb-btn" onClick={() => void finishWalk(false)} disabled={busy}>
              {busy ? "整理中…" : "再保存一次"}
            </button>
          </div>
        </div>
      ) : confirmLeave ? (
        <div className="bb-cap-walk">
          <p className="bb-field-hint">走查会离开这张单，已写的标题、描述和附件不会带过去。</p>
          <div className="bb-cap-actions">
            <button type="button" className="bb-btn" onClick={() => void startWalk()}>
              继续录
            </button>
            <button type="button" className="bb-btn bb-btn-ghost" onClick={() => setConfirmLeave(false)}>
              留在这张单
            </button>
          </div>
        </div>
      ) : (
        <div className="bb-cap-walk">
          <p className="bb-field-hint">边说边录屏幕。要标出一块，录的时候圈一下，这一帧会自己留下。</p>
          <div className="bb-cap-actions">
            <button type="button" className="bb-btn bb-btn-secondary" onClick={requestWalk} disabled={recording !== null}>
              录一段走查
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function pickerCancelled(error: unknown) {
  return error instanceof DOMException && (error.name === "AbortError" || error.name === "NotAllowedError");
}

function formatClock(total: number) {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
