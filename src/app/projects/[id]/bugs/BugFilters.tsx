"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function BugFilters({
  projectId,
  status,
  priority,
  reporter,
  reporters,
  q,
  sort,
  dir,
}: {
  projectId: number;
  status: string;
  priority: string;
  reporter: string;
  reporters: { value: string; label: string }[];
  q: string;
  sort: string;
  dir: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(q);

  function push(next: { status?: string; priority?: string; reporter?: string; q?: string }) {
    const sp = new URLSearchParams();
    const s = next.status ?? status;
    const p = next.priority ?? priority;
    const r = next.reporter ?? reporter;
    const qq = next.q ?? query;
    if (s) sp.set("status", s);
    if (p) sp.set("priority", p);
    if (r) sp.set("reporter", r);
    if (qq) sp.set("q", qq);
    if (!(sort === "updated" && dir === "desc")) {
      if (sort) sp.set("sort", sort);
      if (dir) sp.set("dir", dir);
    }
    const qs = sp.toString();
    router.push(`/projects/${projectId}/bugs${qs ? `?${qs}` : ""}`);
  }

  return (
    <div className="bb-bugs-filters">
      <select
        className="bb-select"
        style={{ width: "auto" }}
        value={status}
        onChange={(e) => push({ status: e.target.value })}
        aria-label="状态筛选"
      >
        <option value="">全部状态</option>
        <option value="pending">待处理</option>
        <option value="fixing">修复中</option>
        <option value="needs_info">待补充</option>
        <option value="awaiting_confirm">待确认</option>
        <option value="confirmed">已确认</option>
        <option value="acknowledged">已认可</option>
        <option value="invalid">不属实</option>
      </select>
      <select
        className="bb-select"
        style={{ width: "auto" }}
        value={priority}
        onChange={(e) => push({ priority: e.target.value })}
        aria-label="优先级筛选"
      >
        <option value="">全部优先级</option>
        <option value="p1">P1</option>
        <option value="p2">P2</option>
        <option value="p3">P3</option>
      </select>
      <select
        className="bb-select"
        style={{ width: "auto", maxWidth: "14rem" }}
        value={reporter}
        onChange={(e) => push({ reporter: e.target.value })}
        aria-label="提交人筛选"
      >
        <option value="">全部提交人</option>
        {reporters.map((row) => (
          <option key={row.value} value={row.value}>
            {row.label}
          </option>
        ))}
      </select>
      <input
        className="bb-input bb-filter-q"
        placeholder="搜索标题或 ID"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") push({ q: query });
        }}
      />
      <button
        type="button"
        className="bb-btn bb-btn-secondary"
        onClick={() => push({ q: query })}
      >
        搜索
      </button>
      {status || priority || reporter || q || query.trim() ? (
        <button
          type="button"
          className="bb-btn bb-btn-ghost"
          onClick={() => {
            setQuery("");
            router.push(`/projects/${projectId}/bugs`);
          }}
        >
          清除
        </button>
      ) : null}
    </div>
  );
}
