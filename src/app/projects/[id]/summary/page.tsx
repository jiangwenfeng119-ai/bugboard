import type { ReactNode } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/session-guard";
import { projectStats, getProject } from "@/lib/services";
import {
  STATUS_FILTER_GROUPS,
  STATUS_LABEL,
  type BugStatus,
  type DayCountSeries,
} from "@/lib/types";
import { StatIcon } from "@/components/StatIcon";
import { IconChart, IconUsers } from "@/components/Icons";
import { TrendChart } from "../TrendChart";
import { SeriesChart, SeriesLegend, type ChartSeries } from "../SeriesChart";
import { DaysSwitcher } from "../DaysSwitcher";
import { listAskGaps, readFeatureMap } from "@/lib/ask-store";
import { readCodeGraph } from "@/lib/code-graph-store";
import { FeatureMapBody } from "./FeatureMapBody";
import { RefreshFeatureMap } from "./RefreshFeatureMap";
import { RefreshCodeGraph } from "./RefreshCodeGraph";

const STATUS_COLOR: Record<BugStatus, string> = {
  pending: "var(--status-pending)",
  fixing: "var(--status-fixing)",
  needs_info: "var(--status-needs)",
  needs_product: "var(--status-product)",
  ready_to_release: "var(--status-ready)",
  awaiting_confirm: "var(--status-awaiting)",
  confirmed: "var(--status-confirmed)",
  acknowledged: "var(--status-acknowledged)",
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
  searchParams: Promise<{ days?: string; showAll?: string }>;
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

  const allEntries: { key: BugStatus | "total"; label: string; value: number }[] = [
    { key: "total", label: "总数", value: stats.total },
    ...(Object.keys(STATUS_LABEL) as BugStatus[]).map((key) => ({
      key,
      label: STATUS_LABEL[key],
      value: stats.byStatus[key],
    })),
  ];
  const showAll = sp.showAll === "1";
  const featureMap = readFeatureMap(identity, Number(id));
  const codeGraph = readCodeGraph(identity, Number(id));
  const gaps = listAskGaps(identity, Number(id));
  const project = getProject(identity, Number(id));
  const visibleEntries = showAll
    ? allEntries
    : allEntries.filter((e) => e.key === "total" || e.value > 0);
  const hiddenZeros = allEntries.length - visibleEntries.length;
  const entryByKey = new Map(visibleEntries.map((entry) => [entry.key, entry]));
  const totalEntry = entryByKey.get("total");
  const statusGroups = STATUS_FILTER_GROUPS.map((group) => ({
    label: group.label,
    entries: group.statuses
      .map((key) => entryByKey.get(key))
      .filter((entry): entry is (typeof visibleEntries)[number] => Boolean(entry)),
  })).filter((group) => group.entries.length > 0);
  const createdTotal = stats.created.reduce((sum, row) => sum + row.count, 0);
  const pendingInflow = stats.inflow.reduce((sum, row) => sum + row.pending, 0);
  const daysQuery = sp.days ? `days=${days}` : "";

  return (
    <div className="bb-summary">
      <section className="bb-summary-stock bb-summary-span">
        <div className="bb-section-head">
          <h2>当前状态</h2>
          {hiddenZeros > 0 || showAll ? (
            <p className="bb-summary-toggle-line">
              {showAll ? (
                <Link
                  className="bb-summary-toggle"
                  href={summaryHref(id, { daysQuery })}
                >
                  收起为零的状态
                </Link>
              ) : (
                <>
                  已收起 {hiddenZeros} 个为零的状态。{" "}
                  <Link
                    className="bb-summary-toggle"
                    href={summaryHref(id, { daysQuery, showAll: true })}
                  >
                    查看全部状态
                  </Link>
                </>
              )}
            </p>
          ) : null}
        </div>
        <p className="bb-stock-note">这些是现在账上的单数，不随时间窗变化。</p>
        <div className="bb-stock-board">
          {totalEntry ? (
            <div className="bb-stock-group">
              <h3>全部</h3>
              <div className="bb-stat-grid">
                <StatLink projectId={id} entry={totalEntry} />
              </div>
            </div>
          ) : null}
          {statusGroups.map((group) => (
            <div key={group.label} className="bb-stock-group">
              <h3>{group.label}</h3>
              <div className="bb-stat-grid">
                {group.entries.map((entry) => (
                  <StatLink key={entry.key} projectId={id} entry={entry} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="bb-card bb-section-card bb-summary-trend bb-summary-span">
        <div className="bb-section-head">
          <h2 className="bb-title-with-icon">
            <span className="bb-title-icon is-sm" aria-hidden>
              <IconChart size={16} />
            </span>
            趋势
          </h2>
          <DaysSwitcher projectId={Number(id)} days={days} showAll={showAll} />
        </div>
        <TrendChart created={stats.created} inflow={stats.inflow} />
        <div className="bb-chart-legend bb-series-legend">
          <span>
            <i className="bb-legend-line" aria-hidden /> 每日新建
            <b>{createdTotal}</b>
          </span>
          <span>
            <i className="bb-legend-bar" aria-hidden /> 待处理流入
            <b>{pendingInflow}</b>
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

      <section className="bb-card bb-section-card bb-summary-span">
        <div className="bb-section-head">
          <h2>功能地图</h2>
          <RefreshFeatureMap projectId={Number(id)} />
        </div>
        {featureMap ? (
          <FeatureMapBody
            body={featureMap.body}
            githubUrl={project.github_url}
            branch={project.default_branch}
          />
        ) : (
          <p className="bb-muted">还没有。更新之后，这里按当前默认分支列出模块和入口。</p>
        )}
      </section>

      <section className="bb-card bb-section-card bb-summary-span">
        <div className="bb-section-head">
          <h2>代码图谱</h2>
          <RefreshCodeGraph projectId={Number(id)} />
        </div>
        {codeGraph ? (
          <>
            <p className="bb-muted">
              基于 {codeGraph.sha.slice(0, 8)}
              {codeGraph.nodes > 0 ? ` · ${codeGraph.nodes} 个节点 · ${codeGraph.edges} 条边` : ""}
              {codeGraph.mirrorSha && codeGraph.mirrorSha !== codeGraph.sha
                ? ` · 问答镜像已经是 ${codeGraph.mirrorSha.slice(0, 8)}，图谱还在上一次提交`
                : ""}
            </p>
            {codeGraph.hasHtml ? (
              <p>
                <a className="bb-ask-link" href={`/api/projects/${id}/code-graph/html`} target="_blank" rel="noreferrer">
                  打开交互图谱
                </a>
              </p>
            ) : null}
            <FeatureMapBody body={codeGraph.body} githubUrl={project.github_url} branch={project.default_branch} />
          </>
        ) : (
          <p className="bb-muted">还没有。更新之后，这里按问答镜像的默认分支列出代码怎么连。</p>
        )}
      </section>

      {gaps.length > 0 ? (
        <section className="bb-card bb-section-card bb-summary-span">
          <h2>最近被判断为还没有的功能</h2>
          <ul className="bb-ask-gaps">
            {gaps.map((gap) => (
              <li key={gap.question}>
                {gap.question}
                <span>{gap.count} 次</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function summaryHref(
  projectId: string,
  opts: { daysQuery?: string; showAll?: boolean }
) {
  const parts = [
    opts.showAll ? "showAll=1" : "",
    opts.daysQuery || "",
  ].filter(Boolean);
  return `/projects/${projectId}/summary${parts.length ? `?${parts.join("&")}` : ""}`;
}

function StatLink({
  projectId,
  entry,
}: {
  projectId: string;
  entry: { key: BugStatus | "total"; label: string; value: number };
}) {
  return (
    <Link
      className={`bb-stat bb-stat-${entry.key}`}
      href={
        entry.key === "total"
          ? `/projects/${projectId}/bugs`
          : `/projects/${projectId}/bugs?status=${entry.key}`
      }
      aria-label={`${entry.label} ${entry.value}`}
    >
      <span className="bb-stat-icon" aria-hidden>
        <StatIcon kind={entry.key} />
      </span>
      <strong>{entry.value}</strong>
      <span>{entry.label}</span>
    </Link>
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
