"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { straightenStroke, type Stroke, type StrokeTool } from "@/lib/strokes";

type Props = {
  imageUrl: string;
  note: string;
  partial: string;
  speaking: boolean;
  onNote: (value: string) => void;
  onSpeak: () => void;
  onCancel: () => void;
  onDone: (file: File, strokes: Stroke[]) => void;
};

export function Annotator({
  imageUrl,
  note,
  partial,
  speaking,
  onNote,
  onSpeak,
  onCancel,
  onDone,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [ready, setReady] = useState(false);
  const drawing = useRef<Stroke | null>(null);
  const straightenTimer = useRef<number | null>(null);

  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      setReady(true);
    };
    image.src = imageUrl;
    return () => {
      if (straightenTimer.current) window.clearTimeout(straightenTimer.current);
    };
  }, [imageUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !ready) return;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * devicePixelRatio));
    canvas.height = Math.max(1, Math.round(rect.height * devicePixelRatio));
    paint(canvas, image, strokes, drawing.current);
  }, [strokes, ready]);

  function pointFrom(event: ReactPointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
    return { x, y };
  }

  function scheduleStraighten() {
    if (straightenTimer.current) window.clearTimeout(straightenTimer.current);
    straightenTimer.current = window.setTimeout(() => {
      setStrokes((prev) => {
        if (!prev.length) return prev;
        const next = prev.slice();
        next[next.length - 1] = straightenStroke(next[next.length - 1]);
        return next;
      });
    }, 500);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (straightenTimer.current) window.clearTimeout(straightenTimer.current);
    event.currentTarget.setPointerCapture(event.pointerId);
    const tool: StrokeTool = event.shiftKey ? "rect" : event.altKey ? "ellipse" : "free";
    const point = pointFrom(event);
    drawing.current = { tool, points: [point, point] };
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (canvas && image) paint(canvas, image, strokes, drawing.current);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const stroke = drawing.current;
    if (!stroke) return;
    const point = pointFrom(event);
    if (stroke.tool === "free") stroke.points.push(point);
    else stroke.points[1] = point;
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (canvas && image) paint(canvas, image, strokes, stroke);
  }

  function onPointerUp() {
    const stroke = drawing.current;
    drawing.current = null;
    if (!stroke || stroke.points.length < 2) return;
    setStrokes((prev) => [...prev, stroke]);
    scheduleStraighten();
  }

  async function finish() {
    const image = imageRef.current;
    if (!image) return;
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = image.naturalWidth || image.width;
    exportCanvas.height = image.naturalHeight || image.height;
    paint(exportCanvas, image, strokes, null);
    const blob = await new Promise<Blob | null>((resolve) => exportCanvas.toBlob(resolve, "image/png"));
    if (!blob) return;
    onDone(new File([blob], `圈选-${Date.now()}.png`, { type: "image/png" }), strokes);
  }

  return createPortal(
    <div className="bb-cap-layer" role="dialog" aria-modal="true" aria-label="圈选截图">
      <div className="bb-cap-stage">
        <canvas
          ref={canvasRef}
          className="bb-cap-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
        <aside className="bb-cap-side">
          <h2>圈出问题</h2>
          <p className="bb-muted">拖动自由画。按住 Shift 画方框，按住 Option 画椭圆。停半秒会把接近的框和圆拉直。</p>
          <label className="bb-label" htmlFor="bb-cap-note">
            备注
          </label>
          <textarea
            id="bb-cap-note"
            className="bb-textarea"
            rows={5}
            value={note}
            onChange={(event) => onNote(event.target.value)}
            placeholder="说或写下哪里不对"
          />
          {partial ? <p className="bb-cap-partial">{partial}</p> : null}
          <div className="bb-cap-actions">
            <button type="button" className="bb-btn bb-btn-ghost" onClick={onSpeak}>
              {speaking ? "停止" : "说一句"}
            </button>
            <button
              type="button"
              className="bb-btn bb-btn-ghost"
              onClick={() => setStrokes((prev) => prev.slice(0, -1))}
              disabled={!strokes.length}
            >
              撤销
            </button>
          </div>
          <div className="bb-cap-actions">
            <button type="button" className="bb-btn bb-btn-ghost" onClick={onCancel}>
              取消
            </button>
            <button type="button" className="bb-btn" onClick={() => void finish()} disabled={!ready}>
              用这张图
            </button>
          </div>
        </aside>
      </div>
    </div>,
    document.body
  );
}

function paint(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  strokes: Stroke[],
  live: Stroke | null
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  ctx.lineWidth = Math.max(2, canvas.width / 180);
  ctx.strokeStyle = "#c62828";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const stroke of live ? [...strokes, live] : strokes) drawStroke(ctx, stroke, canvas.width, canvas.height);
}

function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  width: number,
  height: number
) {
  const [a, b] = [stroke.points[0], stroke.points[stroke.points.length - 1]];
  if (!a || !b) return;
  ctx.beginPath();
  if (stroke.tool === "rect") {
    ctx.strokeRect(a.x * width, a.y * height, (b.x - a.x) * width, (b.y - a.y) * height);
    return;
  }
  if (stroke.tool === "ellipse") {
    const rx = Math.abs(b.x - a.x) * width / 2;
    const ry = Math.abs(b.y - a.y) * height / 2;
    const cx = ((a.x + b.x) / 2) * width;
    const cy = ((a.y + b.y) / 2) * height;
    ctx.ellipse(cx, cy, Math.max(rx, 1), Math.max(ry, 1), 0, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  stroke.points.forEach((point, index) => {
    const x = point.x * width;
    const y = point.y * height;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}
