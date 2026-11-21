"use client";

import { useLayoutEffect, useRef, useState } from "react";

type CreatedPoint = { day: string; count: number };
type InflowPoint = { day: string; pending: number };

export function TrendChart({
  created,
  inflow,
}: {
  created: CreatedPoint[];
  inflow: InflowPoint[];
}) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const pendingByDay = new Map(inflow.map((row) => [row.day, row.pending]));
  const days = created.map((row) => row.day);
  const createdValues = created.map((row) => row.count);
  const pendingValues = created.map((row) => pendingByDay.get(row.day) ?? 0);
  const n = days.length;

  useLayoutEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const measure = () => {
      const next = el.clientWidth;
      if (next > 0) setWidth(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const height = Math.max(168, Math.min(240, Math.round(Math.max(width, 1) * 0.32)));
  const padL = 36;
  const padR = 12;
  const padT = 14;
  const padB = 28;
  const max = Math.max(1, ...createdValues, ...pendingValues);

  function x(i: number) {
    if (n <= 1) return padL + (width - padL - padR) / 2;
    return padL + (i * (width - padL - padR)) / (n - 1);
  }
  function y(value: number) {
    const plotH = height - padT - padB;
    return padT + plotH - (value / max) * plotH;
  }

  function nearest(clientX: number) {
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect || n === 0 || rect.width === 0) return null;
    const rel = (clientX - rect.left) / rect.width;
    if (rel < 0 || rel > 1) return null;
    const vx = rel * width;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < n; i++) {
      const dist = Math.abs(x(i) - vx);
      if (dist < bestDist) {
        best = i;
        bestDist = dist;
      }
    }
    return best;
  }

  const yTicks = axisTicks(max);
  const xTicks = dayTicks(n, width);
  const hoverX = hover === null ? 0 : x(hover);
  const tipAlign =
    hoverX < width * 0.28 ? "is-start" : hoverX > width * 0.68 ? "is-end" : "";
  const slot = n > 0 ? (width - padL - padR) / n : 0;
  const barW = Math.min(18, Math.max(3, slot * 0.46));
  const baseline = y(0);

  return (
    <div className="bb-chart-wrap">
      <div
        className="bb-chart-plot bb-trend-plot"
        ref={plotRef}
        tabIndex={0}
        role="group"
        aria-label="趋势。左右方向键查看某一天。折线是每日新建，柱是待处理流入。"
        onPointerMove={(event) => setHover(nearest(event.clientX))}
        onPointerLeave={() => setHover(null)}
        onKeyDown={(event) => {
          if (n === 0) return;
          if (event.key === "ArrowRight") {
            event.preventDefault();
            setHover((current) => Math.min(n - 1, (current ?? -1) + 1));
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            setHover((current) => Math.max(0, (current ?? n) - 1));
          } else if (event.key === "Home") {
            event.preventDefault();
            setHover(0);
          } else if (event.key === "End") {
            event.preventDefault();
            setHover(n - 1);
          } else if (event.key === "Escape") {
            setHover(null);
          }
        }}
      >
        {width > 0 && n > 0 && (
          <svg
            className="bb-series-chart"
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            aria-hidden
          >
            {yTicks.map((tick) => (
              <g key={tick}>
                <line
                  x1={padL}
                  x2={width - padR}
                  y1={y(tick)}
                  y2={y(tick)}
                  stroke="var(--line)"
                />
                <text x={padL - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle">
                  {tick}
                </text>
              </g>
            ))}
            {xTicks.map((index) => (
              <text
                key={days[index]}
                x={x(index)}
                y={height - 8}
                textAnchor={index === 0 ? "start" : index === n - 1 ? "end" : "middle"}
              >
                {days[index].slice(5)}
              </text>
            ))}
            {pendingValues.map((value, index) =>
              value > 0 ? (
                <rect
                  key={`bar-${days[index]}`}
                  x={x(index) - barW / 2}
                  y={y(value)}
                  width={barW}
                  height={Math.max(0, baseline - y(value))}
                  rx="2"
                  fill="color-mix(in srgb, var(--accent) 40%, white)"
                />
              ) : null
            )}
            <path
              d={linePath(createdValues, x, y)}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {createdValues.map((value, index) =>
              value > 0 ? (
                <circle
                  key={`dot-${days[index]}`}
                  cx={x(index)}
                  cy={y(value)}
                  r="2.5"
                  fill="var(--accent)"
                />
              ) : null
            )}
            {hover !== null && (
              <g>
                <line
                  x1={hoverX}
                  x2={hoverX}
                  y1={padT}
                  y2={height - padB}
                  stroke="var(--ink-muted)"
                  strokeDasharray="3 3"
                />
                {pendingValues[hover] > 0 ? (
                  <rect
                    x={hoverX - barW / 2}
                    y={y(pendingValues[hover])}
                    width={barW}
                    height={Math.max(0, baseline - y(pendingValues[hover]))}
                    rx="2"
                    fill="var(--accent)"
                    opacity="0.55"
                  />
                ) : null}
                <circle
                  cx={hoverX}
                  cy={y(createdValues[hover] || 0)}
                  r="3.5"
                  fill="var(--accent)"
                  stroke="#fff"
                  strokeWidth="1.5"
                />
              </g>
            )}
          </svg>
        )}
        {hover !== null && (
          <div
            className={`bb-chart-tip ${tipAlign}`}
            style={{ left: `${(hoverX / Math.max(width, 1)) * 100}%` }}
            aria-live="polite"
          >
            <strong>{days[hover]}</strong>
            <span>
              <i style={{ background: "var(--accent)" }} aria-hidden />
              每日新建
              <b>{createdValues[hover] || 0}</b>
            </span>
            <span>
              <i
                style={{ background: "color-mix(in srgb, var(--accent) 40%, white)" }}
                aria-hidden
              />
              待处理流入
              <b>{pendingValues[hover] || 0}</b>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function linePath(
  values: number[],
  x: (index: number) => number,
  y: (value: number) => number
) {
  return values
    .map((value, index) => `${index === 0 ? "M" : "L"} ${x(index).toFixed(1)} ${y(value).toFixed(1)}`)
    .join(" ");
}

function axisTicks(max: number) {
  if (max <= 4) return Array.from({ length: max + 1 }, (_, index) => index);
  const mid = Math.round(max / 2);
  return [0, mid, max].filter((value, index, all) => all.indexOf(value) === index);
}

function dayTicks(count: number, width: number) {
  if (count <= 1) return count === 1 ? [0] : [];
  const room = Math.max(2, Math.floor((width - 48) / 56));
  const preferred = count <= 8 ? count : count > 60 ? 6 : 5;
  const slots = Math.min(room, preferred, count);
  if (slots >= count) return Array.from({ length: count }, (_, index) => index);
  const raw = Array.from({ length: slots }, (_, index) =>
    Math.round((index * (count - 1)) / Math.max(slots - 1, 1))
  );
  return [...new Set(raw)];
}
