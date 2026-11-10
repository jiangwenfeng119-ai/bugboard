"use client";

import { useState } from "react";
import { HoverTip } from "@/components/HoverTip";
import {
  STATUS_LABEL,
  type AnalyticsTrend,
  type BugStatus,
  type ReporterAnalytics,
} from "@/lib/types";

const GRAIN_LABEL = { day: "按日", week: "按周", month: "按月" } as const;

const STATUS_ORDER: BugStatus[] = [
  "pending",
  "fixing",
  "needs_info",
  "awaiting_confirm",
  "confirmed",
  "acknowledged",
  "invalid",
];

const STATUS_COLOR: Record<BugStatus, string> = {
  pending: "var(--status-pending)",
  fixing: "var(--status-fixing)",
  needs_info: "var(--status-needs)",
  awaiting_confirm: "var(--status-awaiting)",
  confirmed: "var(--status-confirmed)",
  acknowledged: "var(--status-acknowledged)",
  invalid: "var(--status-invalid)",
};

const TREND_W = 640;
const TREND_H = 228;
const PAD_L = 38;
const PAD_R = 14;
const PAD_T = 16;
const PAD_B = 28;

type RankItem = { key: string; name: string; value: number; rest?: boolean };

export function AnalyticsCharts({ stats }: { stats: ReporterAnalytics }) {
  const projects = rankItems(projectItems(stats));
  const people = rankItems(reporterItems(stats));
  const trendSum = stats.trend.points.reduce((sum, point) => sum + point.count, 0);

  return (
    <div className="bb-viz">
      <VizCard
        title="提交趋势"
        meta={`${GRAIN_LABEL[stats.trend.grain]} · 合计 ${trendSum}`}
      >
        <TrendPlot trend={stats.trend} />
      </VizCard>
      <VizCard title="状态分布" meta="当前状态">
        <StatusDonut stats={stats} />
      </VizCard>
      <VizCard title="应用分布" meta={`${projects.groups} 个应用`}>
        <RankBars rows={projects.rows} empty={stats.totals.total === 0} />
      </VizCard>
      <VizCard title="报障人排名" meta={`${stats.totals.submitters} 个报障人`}>
        <RankBars rows={people.rows} empty={stats.totals.total === 0} />
      </VizCard>
    </div>
  );
}

function VizCard({
  title,
  meta,
  children,
}: {
  title: string;
  meta: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bb-card bb-section-card bb-viz-card">
      <div className="bb-section-head">
        <h2>{title}</h2>
        <span className="bb-viz-meta">{meta}</span>
      </div>
      {children}
    </section>
  );
}

function TrendPlot({ trend }: { trend: AnalyticsTrend }) {
  const [hover, setHover] = useState<{
    index: number;
    x: number;
    y: number;
    hint: string;
    count: number;
  } | null>(null);
  const points = trend.points;
  const peak = points.reduce(
    (best, point) => (point.count > best.count ? point : best),
    points[0] ?? { key: "", label: "", hint: "", count: 0 }
  );
  const sum = points.reduce((total, point) => total + point.count, 0);
  const summary =
    sum === 0
      ? `提交趋势，${GRAIN_LABEL[trend.grain]}，合计 0 条`
      : `提交趋势，${GRAIN_LABEL[trend.grain]}，合计 ${sum} 条，最高 ${peak.hint} ${peak.count} 条`;
  const { top, values } = axisTicks(Math.max(0, ...points.map((point) => point.count)));
  const plotW = TREND_W - PAD_L - PAD_R;
  const plotH = TREND_H - PAD_T - PAD_B;
  const baseline = PAD_T + plotH;

  function xAt(index: number) {
    if (points.length <= 1) return PAD_L + plotW / 2;
    return PAD_L + (index * plotW) / (points.length - 1);
  }
  function yAt(value: number) {
    return baseline - (value / top) * plotH;
  }

  const coords = points.map((point, index) => ({
    x: xAt(index),
    y: yAt(point.count),
  }));
  const line = coords
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");
  const area =
    coords.length > 1
      ? `${line} L ${coords[coords.length - 1].x.toFixed(1)} ${baseline} L ${coords[0].x.toFixed(1)} ${baseline} Z`
      : "";
  const labels = tickIndexes(points.length);

  function onMove(event: React.MouseEvent<SVGSVGElement>) {
    if (points.length === 0) return;
    const svg = event.currentTarget;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const plotX = ((event.clientX - rect.left) / rect.width) * TREND_W;
    const ratio = (plotX - PAD_L) / plotW;
    const index =
      points.length === 1
        ? 0
        : clamp(Math.round(ratio * (points.length - 1)), 0, points.length - 1);
    const card = svg.closest(".bb-viz-card");
    if (!(card instanceof HTMLElement)) return;
    const cardRect = card.getBoundingClientRect();
    const point = points[index];
    const rawX = (xAt(index) / TREND_W) * rect.width + (rect.left - cardRect.left);
    const y = (yAt(point.count) / TREND_H) * rect.height + (rect.top - cardRect.top);
    const x = Math.min(Math.max(rawX, 56), cardRect.width - 56);
    setHover((current) =>
      current?.index === index ? current : { index, x, y, hint: point.hint, count: point.count }
    );
  }

  return (
    <div className="bb-viz-body">
      <svg
        className="bb-trend-svg"
        viewBox={`0 0 ${TREND_W} ${TREND_H}`}
        role="img"
        aria-label={summary}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <title>{summary}</title>
        {area ? <path d={area} className="bb-trend-area" /> : null}
        {values.map((value) => {
          const y = yAt(value);
          return (
            <g key={value}>
              <line
                x1={PAD_L}
                x2={TREND_W - PAD_R}
                y1={y}
                y2={y}
                className={value === 0 ? "bb-trend-base" : "bb-trend-grid"}
              />
              <text x={PAD_L - 8} y={y} textAnchor="end" dominantBaseline="middle">
                {value}
              </text>
            </g>
          );
        })}
        {coords.length > 1 ? (
          <path d={line} pathLength={1} className="bb-trend-draw" />
        ) : null}
        {hover ? (
          <line
            x1={coords[hover.index].x}
            x2={coords[hover.index].x}
            y1={PAD_T}
            y2={baseline}
            className="bb-trend-guide"
          />
        ) : null}
        {points.length <= 14
          ? coords.map((point, index) => (
              <circle key={points[index].key} cx={point.x} cy={point.y} r="2.6" className="bb-trend-dot" />
            ))
          : null}
        {hover ? (
          <>
            <circle cx={coords[hover.index].x} cy={coords[hover.index].y} r="5.5" className="bb-trend-halo" />
            <circle cx={coords[hover.index].x} cy={coords[hover.index].y} r="3.4" className="bb-trend-dot" />
          </>
        ) : null}
        {points.map((point, index) =>
          labels.has(index) ? (
            <text
              key={point.key}
              x={xAt(index)}
              y={TREND_H - 8}
              textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}
            >
              {point.label}
            </text>
          ) : null
        )}
      </svg>
      {hover ? (
        <span
          className="bb-viz-tip"
          style={{
            left: hover.x,
            top: hover.y,
            transform:
              hover.y < 72 ? "translate(-50%, 12px)" : "translate(-50%, calc(-100% - 10px))",
          }}
        >
          <span>{hover.hint}</span>
          <strong>{hover.count} 条</strong>
        </span>
      ) : null}
    </div>
  );
}

function StatusDonut({ stats }: { stats: ReporterAnalytics }) {
  const [active, setActive] = useState<BugStatus | null>(null);
  const total = stats.totals.total;
  const values = STATUS_ORDER.map((status) => stats.totals[status]);
  const shares = shareLabels(values);
  const slices = STATUS_ORDER.map((status, index) => ({
    key: status,
    label: STATUS_LABEL[status],
    value: values[index],
    share: shares[index],
    color: STATUS_COLOR[status],
  }));
  const positive = slices.filter((slice) => slice.value > 0);
  const activeSlice = slices.find((slice) => slice.key === active && slice.value > 0) ?? null;
  const summary = `状态分布，共 ${total} 条。${slices
    .map((slice) => `${slice.label} ${slice.value}`)
    .join("，")}`;

  return (
    <div className="bb-viz-body">
      <div className="bb-donut-layout">
        <svg className="bb-donut-svg" viewBox="0 0 140 140" role="img" aria-label={summary}>
          <title>{summary}</title>
          {positive.length === 0 ? (
            <circle cx="70" cy="70" r="54" className="bb-donut-empty" />
          ) : positive.length === 1 ? (
            <circle
              cx="70"
              cy="70"
              r="54"
              fill="none"
              stroke={positive[0].color}
              strokeWidth="16"
              className="bb-donut-slice"
              onMouseEnter={() => setActive(positive[0].key)}
              onMouseLeave={() => setActive(null)}
            />
          ) : (
            donutPaths(positive).map((slice) => (
              <path
                key={slice.key}
                d={slice.d}
                fill={slice.color}
                className="bb-donut-slice"
                opacity={activeSlice && activeSlice.key !== slice.key ? 0.35 : 1}
                onMouseEnter={() => setActive(slice.key)}
                onMouseLeave={() => setActive(null)}
              />
            ))
          )}
          <text x="70" y="66" textAnchor="middle" className="bb-donut-total">
            {activeSlice ? activeSlice.value : total}
          </text>
          <text x="70" y="86" textAnchor="middle" className="bb-donut-caption">
            {activeSlice ? activeSlice.label : "提交"}
          </text>
        </svg>
        <ul className="bb-donut-legend">
          {slices.map((slice) => (
            <li key={slice.key}>
              <button
                type="button"
                className={active === slice.key ? "is-on" : undefined}
                disabled={slice.value === 0}
                onMouseEnter={() => setActive(slice.key)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(slice.key)}
                onBlur={() => setActive(null)}
              >
                <i
                  className={slice.value === 0 ? "bb-swatch is-empty" : "bb-swatch"}
                  style={slice.value === 0 ? undefined : { background: slice.color }}
                  aria-hidden
                />
                <span>{slice.label}</span>
                <span className={slice.value === 0 ? "bb-viz-num is-zero" : "bb-viz-num"}>
                  {slice.value}
                </span>
                <span className="bb-viz-pct">{slice.share}%</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function RankBars({ rows, empty }: { rows: RankItem[]; empty: boolean }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  if (empty || rows.length === 0) {
    return (
      <div className="bb-viz-body is-empty">
        <p className="bb-viz-empty">这个时间范围内还没有报障。</p>
      </div>
    );
  }
  return (
    <div className="bb-viz-body is-rank">
      <ol className="bb-hbar-list">
        {rows.map((row) => (
          <li key={row.key} className="bb-hbar">
            <HoverTip text={row.name}>
              <span>{row.name}</span>
            </HoverTip>
            <span className="bb-hbar-track" aria-hidden>
              <span
                className={row.rest ? "bb-hbar-fill is-rest" : "bb-hbar-fill"}
                style={{ width: `${(row.value / max) * 100}%` }}
              />
            </span>
            <span className="bb-viz-num">{row.value}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function projectItems(stats: ReporterAnalytics) {
  const map = new Map<number, RankItem>();
  for (const reporter of stats.reporters) {
    for (const project of reporter.projects) {
      const current = map.get(project.projectId);
      if (current) current.value += project.total;
      else {
        map.set(project.projectId, {
          key: String(project.projectId),
          name: project.projectName,
          value: project.total,
        });
      }
    }
  }
  return [...map.values()];
}

function reporterItems(stats: ReporterAnalytics): RankItem[] {
  return stats.reporters
    .filter((row) => row.total > 0)
    .map((row) => ({
      key: `${row.reporterType}:${row.reporterId}`,
      name: row.name,
      value: row.total,
    }));
}

function rankItems(items: RankItem[], limit = 6) {
  const sorted = items
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "zh"));
  if (sorted.length <= limit) return { rows: sorted, groups: sorted.length };
  const head = sorted.slice(0, limit - 1);
  const rest = sorted.slice(limit - 1);
  return {
    groups: sorted.length,
    rows: [
      ...head,
      {
        key: "rest",
        name: `其他 ${rest.length} 个`,
        value: rest.reduce((sum, item) => sum + item.value, 0),
        rest: true,
      },
    ],
  };
}

function donutPaths(slices: { key: BugStatus; value: number; color: string }[]) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  let angle = -Math.PI / 2;
  return slices.map((slice) => {
    const sweep = (slice.value / total) * Math.PI * 2;
    const pad = sweep > 0.2 ? 0.05 : 0;
    const start = angle + pad;
    const end = angle + sweep - pad;
    angle += sweep;
    return { ...slice, d: donutSlice(70, 70, 62, 46, start, Math.max(start + 0.01, end)) };
  });
}

function donutSlice(cx: number, cy: number, outer: number, inner: number, start: number, end: number) {
  const large = end - start > Math.PI ? 1 : 0;
  const point = (radius: number, theta: number) => ({
    x: (cx + Math.cos(theta) * radius).toFixed(2),
    y: (cy + Math.sin(theta) * radius).toFixed(2),
  });
  const a = point(outer, start);
  const b = point(outer, end);
  const c = point(inner, end);
  const d = point(inner, start);
  return `M ${a.x} ${a.y} A ${outer} ${outer} 0 ${large} 1 ${b.x} ${b.y} L ${c.x} ${c.y} A ${inner} ${inner} 0 ${large} 0 ${d.x} ${d.y} Z`;
}

function shareLabels(values: number[]) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return values.map(() => 0);
  const exact = values.map((value) => (value / total) * 100);
  const base = exact.map((value) => Math.floor(value));
  let left = 100 - base.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (const item of order) {
    if (left <= 0) break;
    if (values[item.index] <= 0) continue;
    base[item.index] += 1;
    left -= 1;
  }
  return base;
}

function axisTicks(maxValue: number) {
  const max = Math.max(1, Math.ceil(maxValue));
  const rough = Math.max(1, max / 3);
  const exp = Math.pow(10, Math.floor(Math.log10(rough)));
  const fraction = rough / exp;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  const step = Math.max(1, nice * exp);
  const top = Math.ceil(max / step) * step;
  const values: number[] = [];
  for (let value = 0; value <= top; value += step) values.push(value);
  return { top, values };
}

function tickIndexes(count: number) {
  if (count <= 1) return new Set([0]);
  const target = count <= 8 ? count : 6;
  const indexes = new Set<number>();
  for (let i = 0; i < target; i += 1) {
    indexes.add(Math.round((i * (count - 1)) / (target - 1)));
  }
  return indexes;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
