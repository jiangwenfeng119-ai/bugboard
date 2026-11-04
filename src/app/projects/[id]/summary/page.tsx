import Link from "next/link";
import { requireUser } from "@/lib/session-guard";
import { projectStats } from "@/lib/services";
import { STATUS_LABEL, type BugStatus } from "@/lib/types";
import { StatIcon } from "@/components/StatIcon";
import { IconChart } from "@/components/Icons";
import { TrendChart } from "../TrendChart";
import { DaysSwitcher } from "../DaysSwitcher";

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

  const entries: { key: BugStatus | "total"; label: string; value: number }[] = [
    { key: "total", label: "总数", value: stats.total },
    ...(Object.keys(STATUS_LABEL) as BugStatus[]).map((key) => ({
      key,
      label: STATUS_LABEL[key],
      value: stats.byStatus[key],
    })),
  ];

  return (
    <div>
      <div className="bb-stat-grid" style={{ marginBottom: "1rem" }}>
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
          <h2 className="bb-title-with-icon" style={{ fontSize: "1.02rem" }}>
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
        <p className="bb-muted" style={{ margin: "0.55rem 0 0", fontSize: "0.82rem" }}>
          折线为每日新建；柱状为进入「待处理」的状态流入次数（含打回）。
        </p>
      </div>
    </div>
  );
}
