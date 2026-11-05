import Link from "next/link";
import { requireUser } from "@/lib/session-guard";
import { isSuperAdminRole } from "@/lib/roles";
import { listBugs, resolveBugSort, type BugSortKey } from "@/lib/services";
import { StatusBadge } from "@/components/StatusBadge";
import { PriorityMark } from "@/components/PriorityMark";
import { EmptyState } from "@/components/EmptyState";
import type { BugStatus, Priority } from "@/lib/types";
import { formatDateTime, formatDateTimeShort } from "@/lib/time";
import { BugFilters } from "./BugFilters";
import { DeleteBugButton } from "./DeleteBugButton";
import { NewBugPanel } from "./NewBugPanel";

export const dynamic = "force-dynamic";

const COLUMNS: { key: BugSortKey | null; label: string }[] = [
  { key: null, label: "编号" },
  { key: "id", label: "ID" },
  { key: "priority", label: "优先级" },
  { key: "title", label: "标题" },
  { key: "status", label: "状态" },
  { key: "reporter", label: "提交人" },
  { key: "handler", label: "处理人" },
  { key: "created", label: "创建" },
  { key: "updated", label: "更新" },
];

function defaultSortDir(key: BugSortKey): "asc" | "desc" {
  return key === "updated" || key === "created" || key === "id" ? "desc" : "asc";
}

function listHref(
  projectId: string,
  filters: { status?: string; priority?: string; q?: string },
  sort: BugSortKey,
  dir: "asc" | "desc"
) {
  const sp = new URLSearchParams();
  if (filters.status) sp.set("status", filters.status);
  if (filters.priority) sp.set("priority", filters.priority);
  if (filters.q) sp.set("q", filters.q);
  if (!(sort === "updated" && dir === "desc")) {
    sp.set("sort", sort);
    sp.set("dir", dir);
  }
  const qs = sp.toString();
  return `/projects/${projectId}/bugs${qs ? `?${qs}` : ""}`;
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

export default async function BugsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    status?: string;
    priority?: string;
    q?: string;
    sort?: string;
    dir?: string;
  }>;
}) {
  const identity = await requireUser();
  const canDelete = isSuperAdminRole(identity.role);
  const { id } = await params;
  const sp = await searchParams;
  const order = resolveBugSort(sp.sort, sp.dir);
  const bugs = listBugs(identity, Number(id), {
    status: sp.status as BugStatus | undefined,
    priority: sp.priority as Priority | undefined,
    q: sp.q,
    sort: order.sort,
    dir: order.dir,
  });

  return (
    <div className="bb-bugs-page">
      <div className="bb-bugs-toolbar">
        <BugFilters
          projectId={Number(id)}
          status={sp.status || ""}
          priority={sp.priority || ""}
          q={sp.q || ""}
          sort={order.sort}
          dir={order.dir}
        />
        <NewBugPanel projectId={Number(id)} />
      </div>

      {bugs.length === 0 ? (
        <EmptyState
          imageSrc="/brand/empty-bugs.png"
          title="暂无报障"
          description="点击「新建报障」提交第一条，支持文字、附件与录音。"
          action={<NewBugPanel projectId={Number(id)} />}
        />
      ) : (
        <div className="bb-card bb-table-wrap">
          <table className={`bb-table bb-bug-table${canDelete ? " has-remove" : ""}`}>
            <colgroup>
              <col className="bb-col-num" />
              <col className="bb-col-id" />
              <col className="bb-col-pri" />
              <col />
              <col className="bb-col-status" />
              <col className="bb-col-reporter" />
              <col className="bb-col-reporter" />
              <col className="bb-col-time" />
              <col className="bb-col-time" />
              {canDelete ? <col className="bb-col-remove" /> : null}
            </colgroup>
            <thead>
              <tr>
                {COLUMNS.map((col) => {
                  if (!col.key) {
                    return (
                      <th key={col.label}>
                        <span className="bb-th-label">{col.label}</span>
                      </th>
                    );
                  }
                  const active = order.sort === col.key;
                  const nextDir = active
                    ? order.dir === "asc"
                      ? "desc"
                      : "asc"
                    : defaultSortDir(col.key);
                  const href = listHref(
                    id,
                    { status: sp.status, priority: sp.priority, q: sp.q },
                    col.key,
                    nextDir
                  );
                  return (
                    <th
                      key={col.key}
                      aria-sort={
                        active
                          ? order.dir === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <Link
                        href={href}
                        className={active ? "bb-sort is-active" : "bb-sort"}
                        scroll={false}
                      >
                        {col.label}
                        <SortMark active={active} dir={order.dir} />
                      </Link>
                    </th>
                  );
                })}
                {canDelete ? <th className="bb-col-remove" /> : null}
              </tr>
            </thead>
            <tbody>
              {bugs.map((b, index) => {
                const createdFull = formatDateTime(b.created_at);
                const createdShort = formatDateTimeShort(b.created_at);
                const updatedFull = formatDateTime(b.updated_at);
                const updatedShort = formatDateTimeShort(b.updated_at);
                return (
                  <tr key={b.id}>
                    <td className="bb-num">{index + 1}</td>
                    <td className="bb-nowrap">
                      <Link href={`/bugs/${b.id}`} className="bb-bug-id" title={b.public_id}>
                        {b.public_id}
                      </Link>
                    </td>
                    <td>
                      <PriorityMark priority={b.priority} />
                    </td>
                    <td className="bb-ellipsis bb-title-cell">
                      <Link href={`/bugs/${b.id}`} title={b.title}>
                        <strong>{b.title}</strong>
                      </Link>
                    </td>
                    <td>
                      <StatusBadge status={b.status} />
                    </td>
                    <td className="bb-ellipsis" title={b.reporter_label}>
                      {b.reporter_label}
                    </td>
                    <td className="bb-ellipsis" title={b.handler_label || "暂无处理人"}>
                      {b.handler_label || <span className="bb-muted">—</span>}
                    </td>
                    <td className="bb-muted bb-nowrap" title={createdFull}>
                      {createdShort}
                    </td>
                    <td className="bb-muted bb-nowrap" title={updatedFull}>
                      {updatedShort}
                    </td>
                    {canDelete ? (
                      <td className="bb-remove-cell">
                        <DeleteBugButton bugId={b.id} title={b.title} />
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
