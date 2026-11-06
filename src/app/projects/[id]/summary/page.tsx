import type { ReactNode } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/session-guard";
import { projectStats } from "@/lib/services";
import { STATUS_LABEL, type BugStatus, type DayCountSeries } from "@/lib/types";
import { StatIcon } from "@/components/StatIcon";
import { IconChart, IconUsers } from "@/components/Icons";
import { TrendChart } from "../TrendChart";
import { SeriesChart, SeriesLegend, type ChartSeries } from "../SeriesChart";
import { DaysSwitcher } from "../DaysSwitcher";

const STATUS_COLOR: Record<BugStatus, string> = {
  pending: "var(--status-pending)",
  fixing: "var(--status-fixing)",
  needs_info: "var(--status-needs)",
  awaiting_confirm: "var(--status-awaiting)",
  confirmed: "var(--status-confirmed)",
  invalid: "var(--status-invalid)",
};

const PERSON_COLOR = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
];

export const dynamic = "force-dynamic";

export default async function ProjectSummaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const identity = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const days = ([7, 30, 90].includes(Number(sp.days))
    ? Number(sp.days)
    : 30) as 7 | 30 | 90;
  const stats = projectStats(identity, Number(id), days);

  const daysList = stats.created.map((row) => row.day);
  const statusSeries: ChartSeries[] = (Object.keys(STATUS_LABEL) as BugStatus[]).map(
    (key) => ({
      key,
      label: STATUS_LABEL[key],
      color: STATUS_COLOR[key],
      values: stats.inflow.map((row) => row[key]),
    })
  );
  const reporterSeries = colorPeople(stats.createdByReporter);
  const actorSeries = colorPeople(stats.movedByActor);

  const entries: { key: BugStatus | "total"; label: string; value: number }[] = [
    { key: "total", label: "总数", value: stats.total },
    ...(Object.keys(STATUS_LABEL) as BugStatus[]).map((key) => ({
      key,
      label: STATUS_LABEL[key],
      value: stats.byStatus[key],
    })),
  ];

  return (
    <div className="bb-summary">
      <div className="bb-stat-grid">
        {entries.map((e) => (
          <Link
            key={e.key}
            className={`bb-stat bb-stat-${e.key}`}
            href={
              e.key === "total"
                ? `/projects/${id}/bugs`
                : `/projects/${id}/bugs?status=${e.key}`
            }
          >
            <span className="bb-stat-icon" aria-hidden>
              <StatIcon kind={e.key} />
            </span>
            <strong>{e.value}</strong>
            <span>{e.label}</span>
          </Link>
        ))}
      </div>

      <div className="bb-card bb-section-card">
        <div className="bb-section-head">
          <h2 className="bb-title-with-icon">
            <span className="bb-title-icon is-sm" aria-hidden>
              <IconChart size={16} />
            </span>
            趋势
          </h2>
          <DaysSwitcher projectId={Number(id)} days={days} />
        </div>
        <div className="bb-chart-wrap">
          <TrendChart created={stats.created} inflow={stats.inflow} />
        </div>
        <div className="bb-chart-legend">
          <span>
            <i className="bb-legend-line" aria-hidden /> 每日新建
          </span>
          <span>
            <i className="bb-legend-bar" aria-hidden /> 待处理流入
          </span>
        </div>
        <p className="bb-chart-note">
          折线为每日新建；柱状为进入「待处理」的次数（含打回）。状态和人员图共用这个时间窗。
        </p>
      </div>

      <div className="bb-summary-charts">
        <TrendBlock title="状态流入" icon={<IconChart size={16} />} wide>
          <SeriesChart days={daysList} series={statusSeries} title="状态流入" />
          <SeriesLegend series={statusSeries} />
          <p className="bb-chart-note">
            每天进入该状态的次数，含打回和异议。这是流入，不是当天还留在该状态的单量。
          </p>
        </TrendBlock>

        <PeopleTrend
          title="按提报人"
          series={reporterSeries}
          days={daysList}
          empty="这个时间窗里没有新提的报障。"
          caption="每人每天新提的报障。"
        />
        <PeopleTrend
          title="按处理人"
          series={actorSeries}
          days={daysList}
          empty="这个时间窗里没有状态变更。"
          caption="每人每天推动的状态变更，不含建单。"
        />
      </div>
    </div>
  );
}

function PeopleTrend({
  title,
  series,
  days,
  empty,
  caption,
}: {
  title: string;
  series: ChartSeries[];
  days: string[];
  empty: string;
  caption: string;
}) {
  const note = series.some((item) => item.key === "other")
    ? `${caption}其余人合计为「其他」。`
    : caption;
  return (
    <TrendBlock title={title} icon={<IconUsers size={16} />}>
      {series.length === 0 ? (
        <p className="bb-chart-empty">{empty}</p>
      ) : (
        <>
          <SeriesChart days={days} series={series} title={title} />
          <SeriesLegend series={series} />
        </>
      )}
      <p className="bb-chart-note">{note}</p>
    </TrendBlock>
  );
}

function TrendBlock({
  title,
  icon,
  wide,
  children,
}: {
  title: string;
  icon: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`bb-card bb-section-card${wide ? " is-wide" : ""}`}>
      <h2 className="bb-title-with-icon">
        <span className="bb-title-icon is-sm" aria-hidden>
          {icon}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function colorPeople(rows: DayCountSeries[]): ChartSeries[] {
  let colorIndex = 0;
  return rows.map((row) => {
    if (row.key === "other") {
      return {
        key: row.key,
        label: row.label,
        color: "var(--ink-muted)",
        values: row.counts,
        dashed: true,
      };
    }
    const color = PERSON_COLOR[colorIndex % PERSON_COLOR.length];
    colorIndex += 1;
    return { key: row.key, label: row.label, color, values: row.counts };
  });
}
