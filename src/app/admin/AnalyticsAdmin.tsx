"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { IconArrowRight } from "@/components/Icons";
import { StatIcon } from "@/components/StatIcon";
import { STATUS_LABEL, type BugStatus, type ReporterAnalytics, type ReporterStat } from "@/lib/types";
import { AnalyticsCharts } from "./AnalyticsCharts";

type SortKey = "name" | "total" | "adopted" | "confirmed" | "invalid" | "pending" | "rate";
type KindFilter = "all" | "user" | "api_key";

const PRESENCE_LABEL: Record<ReporterStat["presence"], string | null> = {
  active: null,
  disabled: "已停用",
  revoked: "已吊销",
  missing: null,
};

export function AnalyticsAdmin({ stats }: { stats: ReporterAnalytics }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [includeEmpty, setIncludeEmpty] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [openKey, setOpenKey] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("zh");
    const filtered = stats.reporters.filter((row) => {
      if (kind !== "all" && row.reporterType !== kind) return false;
      if (q && !row.name.toLocaleLowerCase("zh").includes(q)) return false;
      if (!includeEmpty && !q && row.total === 0) return false;
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    return filtered.sort((a, b) => {
      const diff = compareReporters(a, b, sortKey);
      if (diff !== 0) return diff * dir;
      return a.name.localeCompare(b.name, "zh");
    });
  }, [stats.reporters, query, kind, includeEmpty, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(key === "name" ? "asc" : "desc");
  }

  const summary: { key: BugStatus | "total" | "adopted"; label: string; value: number }[] = [
    { key: "total", label: "提交", value: stats.totals.total },
    { key: "adopted", label: "已采纳", value: stats.totals.adopted },
    { key: "confirmed", label: "已确认修复", value: stats.totals.confirmed },
    { key: "awaiting_confirm", label: "待确认", value: stats.totals.awaiting_confirm },
    { key: "invalid", label: "不属实", value: stats.totals.invalid },
    { key: "pending", label: "待处理", value: stats.totals.pending },
  ];

  return (
    <div>
      <div className="bb-analytics-toolbar">
        <p className="bb-muted bb-analytics-lead">
          {stats.totals.total > 0
            ? `${stats.totals.submitters} 个报障人有提交，确认率 ${rateLabel(stats.totals.confirmed, stats.totals.total)}`
            : `${stats.totals.submitters} 个报障人有提交`}
        </p>
        <div className="bb-analytics-tools">
          <select
            className="bb-select"
            style={{ width: "auto" }}
            aria-label="时间范围"
            value={stats.range}
            onChange={(e) => {
              const range = e.target.value;
              router.push(
                range === "all" ? "/admin?tab=analytics" : `/admin?tab=analytics&range=${range}`
              );
            }}
          >
            <option value="all">全部时间</option>
            <option value="7">近 7 天</option>
            <option value="30">近 30 天</option>
            <option value="90">近 90 天</option>
          </select>
          <select
            className="bb-select"
            style={{ width: "auto" }}
            aria-label="报障人类型"
            value={kind}
            onChange={(e) => setKind(e.target.value as KindFilter)}
          >
            <option value="all">全部报障人</option>
            <option value="user">仅用户</option>
            <option value="api_key">仅 API Key</option>
          </select>
          <input
            className="bb-input bb-input-compact"
            value={query}
            placeholder="搜索报障人"
            aria-label="搜索报障人"
            onChange={(e) => setQuery(e.target.value)}
          />
          <label className="bb-checkline">
            <input
              type="checkbox"
              checked={includeEmpty}
              onChange={(e) => setIncludeEmpty(e.target.checked)}
            />
            显示未提交
          </label>
        </div>
      </div>

      <div className="bb-stat-grid bb-analytics-stats">
        {summary.map((item) => (
          <div key={item.key} className={`bb-stat bb-stat-${item.key} is-static`}>
            <span className="bb-stat-icon" aria-hidden>
              <StatIcon kind={item.key === "adopted" ? "fixing" : item.key} />
            </span>
            <strong>{item.value}</strong>
            <span>{item.label}</span>
          </div>
        ))}
      </div>

      <AnalyticsCharts stats={stats} />

      <section className="bb-card bb-section-card">
        <h2>按报障人</h2>
        {rows.length === 0 ? (
          <p className="bb-muted" style={{ margin: "0.2rem 0 0" }}>
            {stats.totals.total === 0
              ? "这个时间范围内还没有报障。勾选「显示未提交」可以查看还没提过单的用户。"
              : "没有符合条件的报障人。"}
          </p>
        ) : (
          <div className="bb-table-wrap">
            <table className="bb-table bb-analytics-table">
              <thead>
                <tr>
                  <SortableTh
                    label="报障人"
                    sortKey="name"
                    active={sortKey}
                    dir={sortDir}
                    onSort={toggleSort}
                  />
                  <SortableTh
                    label="提交"
                    sortKey="total"
                    active={sortKey}
                    dir={sortDir}
                    onSort={toggleSort}
                    align="end"
                    hint="所选时间内创建的报障数"
                  />
                  <th>应用</th>
                  <SortableTh
                    label="已采纳"
                    sortKey="adopted"
                    active={sortKey}
                    dir={sortDir}
                    onSort={toggleSort}
                    align="end"
                    hint="当前为修复中、待确认或已确认"
                  />
                  <SortableTh
                    label="已确认"
                    sortKey="confirmed"
                    active={sortKey}
                    dir={sortDir}
                    onSort={toggleSort}
                    align="end"
                    hint="原报障人已确认修复"
                  />
                  <SortableTh
                    label="不属实"
                    sortKey="invalid"
                    active={sortKey}
                    dir={sortDir}
                    onSort={toggleSort}
                    align="end"
                  />
                  <SortableTh
                    label="待处理"
                    sortKey="pending"
                    active={sortKey}
                    dir={sortDir}
                    onSort={toggleSort}
                    align="end"
                  />
                  <SortableTh
                    label="确认率"
                    sortKey="rate"
                    active={sortKey}
                    dir={sortDir}
                    onSort={toggleSort}
                    align="end"
                    hint="已确认 ÷ 提交"
                  />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const key = `${row.reporterType}:${row.reporterId}`;
                  const open = openKey === key && row.projects.length > 0;
                  const presence = PRESENCE_LABEL[row.presence];
                  return (
                    <ReporterRows
                      key={key}
                      row={row}
                      open={open}
                      presence={presence}
                      onToggle={() => setOpenKey(open ? null : key)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="bb-muted bb-analytics-note">
          已采纳指当前停在「修复中」「待确认」或「已确认」：管理员接过单，而且现在没有标成不属实。打回或异议回到待处理的不算。已确认是原报障人确认修复，也就是被采纳并走完闭环，已包含在已采纳里。按报障创建时间落入所选区间，状态取当前状态。
        </p>
      </section>
    </div>
  );
}

function ReporterRows({
  row,
  open,
  presence,
  onToggle,
}: {
  row: ReporterStat;
  open: boolean;
  presence: string | null;
  onToggle: () => void;
}) {
  const shown = row.projects.slice(0, 3);
  const extra = row.projects.length - shown.length;
  return (
    <>
      <tr>
        <td>
          {row.projects.length > 0 ? (
            <button
              type="button"
              className="bb-row-toggle"
              aria-expanded={open}
              onClick={onToggle}
            >
              <IconArrowRight
                size={14}
                className={open ? "bb-chevron is-open" : "bb-chevron"}
              />
              <span>
                <span className="bb-reporter-name">{row.name}</span>
                <span className="bb-reporter-meta">
                  {row.reporterType === "user" ? "用户" : "API Key"}
                  {presence ? ` · ${presence}` : ""}
                </span>
              </span>
            </button>
          ) : (
            <span className="bb-row-toggle is-static">
              <span>
                <span className="bb-reporter-name">{row.name}</span>
                <span className="bb-reporter-meta">
                  {row.reporterType === "user" ? "用户" : "API Key"}
                  {presence ? ` · ${presence}` : ""}
                </span>
              </span>
            </span>
          )}
        </td>
        <Num value={row.total} />
        <td>
          {shown.length === 0 ? (
            <span className="bb-muted">—</span>
          ) : (
            <span className="bb-pill-row">
              {shown.map((project) => (
                <span key={project.projectId} className="bb-pill" title={project.projectName}>
                  <span className="bb-ellipsis">{project.projectName}</span>
                  <b>{project.total}</b>
                </span>
              ))}
              {extra > 0 ? <span className="bb-pill">+{extra}</span> : null}
            </span>
          )}
        </td>
        <Num value={row.adopted} />
        <Num value={row.confirmed} tone="ok" />
        <Num value={row.invalid} />
        <Num value={row.pending} />
        <td className={`bb-num${row.total === 0 ? " is-zero" : ""}`}>
          {rateLabel(row.confirmed, row.total)}
        </td>
      </tr>
      {open ? (
        <tr className="bb-analytics-detail">
          <td colSpan={8}>
            <table className="bb-table bb-subtable">
              <thead>
                <tr>
                  <th>应用</th>
                  <th className="bb-num">提交</th>
                  <th className="bb-num">已采纳</th>
                  <th className="bb-num">已确认</th>
                  <th className="bb-num">{STATUS_LABEL.fixing}</th>
                  <th className="bb-num">{STATUS_LABEL.awaiting_confirm}</th>
                  <th className="bb-num">{STATUS_LABEL.invalid}</th>
                  <th className="bb-num">{STATUS_LABEL.pending}</th>
                </tr>
              </thead>
              <tbody>
                {row.projects.map((project) => (
                  <tr key={project.projectId}>
                    <td>
                      <Link href={`/projects/${project.projectId}/bugs`}>{project.projectName}</Link>
                    </td>
                    <Num value={project.total} />
                    <Num value={project.adopted} />
                    <Num value={project.confirmed} tone="ok" />
                    <Num value={project.fixing} />
                    <Num value={project.awaiting_confirm} />
                    <Num value={project.invalid} />
                    <Num value={project.pending} />
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function Num({ value, tone }: { value: number; tone?: "ok" }) {
  const toneClass = tone && value > 0 ? ` is-${tone}` : "";
  return <td className={`bb-num${value === 0 ? " is-zero" : ""}${toneClass}`}>{value}</td>;
}

function SortableTh({
  label,
  sortKey,
  active,
  dir,
  onSort,
  align,
  hint,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  dir: "asc" | "desc";
  onSort: (key: SortKey) => void;
  align?: "end";
  hint?: string;
}) {
  const isActive = active === sortKey;
  return (
    <th className={align === "end" ? "bb-num" : undefined} aria-sort={isActive ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className={`bb-sort${isActive ? " is-active" : ""}${align === "end" ? " is-end" : ""}`}
        title={hint}
        onClick={() => onSort(sortKey)}
      >
        {label}
        <SortMark active={isActive} dir={dir} />
      </button>
    </th>
  );
}

function SortMark({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) {
    return (
      <svg className="bb-sort-icon" width="10" height="10" viewBox="0 0 10 10" aria-hidden>
        <path d="M5 1.5 7.1 3.5H2.9L5 1.5Z" fill="currentColor" />
        <path d="M5 8.5 2.9 6.5h4.2L5 8.5Z" fill="currentColor" />
      </svg>
    );
  }
  const up = dir === "asc";
  return (
    <svg className="bb-sort-icon is-on" width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <path
        d={up ? "M2 6.6 5 3.2 8 6.6" : "M2 3.4 5 6.8 8 3.4"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function compareReporters(a: ReporterStat, b: ReporterStat, key: SortKey) {
  if (key === "name") return a.name.localeCompare(b.name, "zh");
  if (key === "rate") {
    const ar = a.total === 0 ? -1 : a.confirmed / a.total;
    const br = b.total === 0 ? -1 : b.confirmed / b.total;
    return ar - br;
  }
  return a[key] - b[key];
}

function rateLabel(confirmed: number, total: number) {
  if (total === 0) return "—";
  return `${Math.round((confirmed / total) * 100)}%`;
}
