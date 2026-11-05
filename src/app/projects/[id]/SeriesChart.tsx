"use client";

import { useLayoutEffect, useRef, useState } from "react";

export type ChartSeries = {
  key: string;
  label: string;
  color: string;
  values: number[];
  dashed?: boolean;
};

export function SeriesChart({
  days,
  series,
  title,
}: {
  days: string[];
  series: ChartSeries[];
  title: string;
}) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
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

  const height = Math.max(148, Math.min(260, Math.round(Math.max(width, 1) * 0.46)));
  const padL = 36;
  const padR = 12;
  const padT = 14;
  const padB = 28;
  const max = Math.max(1, ...series.flatMap((item) => item.values));

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
  const showDots = n > 0 && n <= 40;

  return (
    <div className="bb-chart-wrap">
      <div
        className="bb-chart-plot"
        ref={plotRef}
        tabIndex={0}
        role="group"
        aria-label={`${title}。左右方向键查看某一天。`}
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
        {width > 0 && (
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
            {[...series].reverse().map((item) => (
              <path
                key={item.key}
                d={linePath(item.values, x, y)}
                fill="none"
                stroke={item.color}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={item.dashed ? "5 4" : undefined}
              />
            ))}
            {showDots &&
              series.map((item) =>
                item.values.map((value, index) =>
                  value > 0 ? (
                    <circle
                      key={`${item.key}-${days[index]}`}
                      cx={x(index)}
                      cy={y(value)}
                      r="2.5"
                      fill={item.color}
                    />
                  ) : null
                )
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
                {series.map((item) => (
                  <circle
                    key={item.key}
                    cx={hoverX}
                    cy={y(item.values[hover] || 0)}
                    r="3.5"
                    fill={item.color}
                    stroke="#fff"
                    strokeWidth="1.5"
                  />
                ))}
              </g>
            )}
          </svg>
        )}
        {hover !== null && (
          <div
            className={`bb-chart-tip ${tipAlign}`}
            style={{ left: `${(hoverX / Math.max(width, 1)) * 100}%` }}
          >
            <strong>{days[hover]}</strong>
            {series.map((item) => (
              <span key={item.key}>
                <i style={{ background: item.color }} aria-hidden />
                {item.label}
                <b>{item.values[hover] || 0}</b>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function SeriesLegend({ series }: { series: ChartSeries[] }) {
  return (
    <div className="bb-chart-legend bb-series-legend">
      {series.map((item) => {
        const total = item.values.reduce((sum, value) => sum + value, 0);
        return (
          <span key={item.key}>
            <i
              className={item.dashed ? "bb-legend-swatch is-dashed" : "bb-legend-swatch"}
              style={item.dashed ? undefined : { background: item.color }}
              aria-hidden
            />
            {item.label}
            <b>{total}</b>
          </span>
        );
      })}
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
