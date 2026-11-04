"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function BugFilters({
  projectId,
  status,
  priority,
  q,
  sort,
  dir,
}: {
  projectId: number;
  status: string;
  priority: string;
  q: string;
  sort: string;
  dir: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(q);

  function push(next: { status?: string; priority?: string; q?: string }) {
    const sp = new URLSearchParams();
    const s = next.status ?? status;
    const p = next.priority ?? priority;
    const qq = next.q ?? query;
    if (s) sp.set("status", s);
    if (p) sp.set("priority", p);
    if (qq) sp.set("q", qq);
    if (!(sort === "updated" && dir === "desc")) {
      if (sort) sp.set("sort", sort);
      if (dir) sp.set("dir", dir);
    }
    const qs = sp.toString();
    router.push(`/projects/${projectId}/bugs${qs ? `?${qs}` : ""}`);
  }

  return (
    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
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
        <option value="awaiting_confirm">待确认</option>
        <option value="confirmed">已确认</option>
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
      <input
        className="bb-input"
        style={{ width: 200 }}
        placeholder="搜索标题"
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
    </div>
  );
}
