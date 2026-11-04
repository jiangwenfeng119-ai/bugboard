"use client";

type Point = { day: string; count?: number; pending?: number };

export function TrendChart({
  created,
  inflow,
}: {
  created: { day: string; count: number }[];
  inflow: { day: string; pending: number }[];
}) {
  const width = 1000;
  const height = 220;
  const pad = 24;
  const max = Math.max(
    1,
    ...created.map((c) => c.count),
    ...inflow.map((i) => i.pending)
  );
  const n = created.length || 1;

  function x(i: number) {
    return pad + (i * (width - pad * 2)) / Math.max(n - 1, 1);
  }
  function y(v: number) {
    return height - pad - (v / max) * (height - pad * 2);
  }

  const line = created
    .map((c, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(c.count)}`)
    .join(" ");

  const barW = Math.max(4, (width - pad * 2) / n / 2.2);

  return (
    <svg className="bb-chart" viewBox={`0 0 ${width} ${height}`} role="img">
      <title>报障趋势图</title>
      {inflow.map((p, i) => (
        <rect
          key={p.day}
          x={x(i) - barW / 2}
          y={y(p.pending)}
          width={barW}
          height={Math.max(0, y(0) - y(p.pending))}
          fill="color-mix(in srgb, #1f6feb 28%, white)"
        />
      ))}
      <path d={line} fill="none" stroke="#1f6feb" strokeWidth="2.5" />
      {created.map((c, i) => (
        <circle key={c.day} cx={x(i)} cy={y(c.count)} r="3" fill="#1f6feb" />
      ))}
    </svg>
  );
}
