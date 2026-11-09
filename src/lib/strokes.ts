export type StrokeTool = "free" | "rect" | "ellipse";

export type NormPoint = { x: number; y: number };

export type Stroke = {
  tool: StrokeTool;
  points: NormPoint[];
};

const TOOLS = new Set<StrokeTool>(["free", "rect", "ellipse"]);

export function isNormPoint(value: unknown): value is NormPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as NormPoint;
  return (
    typeof point.x === "number" &&
    typeof point.y === "number" &&
    point.x >= 0 &&
    point.x <= 1 &&
    point.y >= 0 &&
    point.y <= 1
  );
}

export function parseStrokes(value: unknown): Stroke[] {
  if (value == null || value === "") return [];
  const raw = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(raw)) throw new Error("圈选数据无效");
  if (raw.length > 40) throw new Error("圈选笔数过多");
  return raw.map((item) => {
    if (!item || typeof item !== "object") throw new Error("圈选数据无效");
    const stroke = item as Stroke;
    if (!TOOLS.has(stroke.tool)) throw new Error("圈选数据无效");
    if (!Array.isArray(stroke.points) || stroke.points.length < 2) {
      throw new Error("圈选数据无效");
    }
    if (stroke.points.length > 400) throw new Error("圈选笔数过多");
    if (!stroke.points.every(isNormPoint)) throw new Error("圈选坐标无效");
    return { tool: stroke.tool, points: stroke.points.map((p) => ({ x: p.x, y: p.y })) };
  });
}

function bounds(points: NormPoint[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function distance(a: NormPoint, b: NormPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function closed(points: NormPoint[], box: ReturnType<typeof bounds>) {
  const gap = distance(points[0], points[points.length - 1]);
  const diagonal = Math.hypot(box.w, box.h);
  return gap < 0.04 || gap < diagonal * 0.18;
}

function edgeRatio(points: NormPoint[], box: ReturnType<typeof bounds>) {
  const tol = Math.max(0.012, Math.min(box.w, box.h) * 0.06);
  let near = 0;
  for (const point of points) {
    const onEdge =
      Math.abs(point.x - box.minX) <= tol ||
      Math.abs(point.x - box.maxX) <= tol ||
      Math.abs(point.y - box.minY) <= tol ||
      Math.abs(point.y - box.maxY) <= tol;
    if (onEdge) near += 1;
  }
  return near / points.length;
}

function ellipseFit(points: NormPoint[], box: ReturnType<typeof bounds>) {
  const rx = box.w / 2;
  const ry = box.h / 2;
  if (rx < 0.01 || ry < 0.01) return 0;
  const cx = box.minX + rx;
  const cy = box.minY + ry;
  let score = 0;
  for (const point of points) {
    const value = ((point.x - cx) / rx) ** 2 + ((point.y - cy) / ry) ** 2;
    if (Math.abs(1 - value) <= 0.22) score += 1;
  }
  return score / points.length;
}

/** A stroke that rested long enough: snap a rough box or circle, leave real handwriting alone. */
export function straightenStroke(stroke: Stroke): Stroke {
  if (stroke.tool !== "free" || stroke.points.length < 8) return stroke;
  const box = bounds(stroke.points);
  if (box.w < 0.03 && box.h < 0.03) return stroke;
  if (!closed(stroke.points, box)) return stroke;
  const corners = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.maxY },
  ];
  if (edgeRatio(stroke.points, box) >= 0.72) {
    return { tool: "rect", points: corners };
  }
  if (ellipseFit(stroke.points, box) >= 0.7) {
    return { tool: "ellipse", points: corners };
  }
  return stroke;
}
