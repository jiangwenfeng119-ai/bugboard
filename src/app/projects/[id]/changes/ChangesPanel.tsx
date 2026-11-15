"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { HoverTip } from "@/components/HoverTip";
import type { ProjectChangeKind } from "@/lib/types";

export type ChangeListItem = {
  id: number;
  kind: ProjectChangeKind;
  kindLabel: string;
  title: string;
  note: string | null;
  actor: string;
  createdLabel: string;
  createdFull: string;
  shas: { sha: string; short: string; href: string | null }[];
  bugs: { id: number; label: string; href: string | null }[];
  onlineLabel: string;
  onlineTone: "ok" | "muted" | "danger";
  onlineHint: string | null;
};

export type PendingReleaseBug = {
  id: number;
  publicId: string;
  title: string;
};

const KIND_CLASS: Record<ProjectChangeKind, string> = {
  fix: "bb-badge bb-badge-change-fix",
  feature: "bb-badge bb-badge-change-feature",
  chore: "bb-badge bb-badge-change-chore",
  release: "bb-badge bb-badge-change-release",
};

export function ChangesPanel({
  projectId,
  filter,
  items,
  total,
  canRelease,
  pendingBugs,
}: {
  projectId: number;
  filter: "" | "code" | "release";
  items: ChangeListItem[];
  total: number;
  canRelease: boolean;
  pendingBugs: PendingReleaseBug[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<number[]>([]);
  const [confirming, setConfirming] = useState<null | "run" | "mark">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const pendingIds = new Set(pendingBugs.map((bug) => bug.id));
  const chosen = selected.filter((id) => pendingIds.has(id));

  function toggle(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
    setConfirming(null);
  }

  async function submit(mode: "run" | "mark") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const bugIds = chosen.length > 0 ? chosen : undefined;
      const res = await fetch(`/api/projects/${projectId}/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          trigger: mode === "run" ? "manual" : "external",
          ...(bugIds ? { bugIds } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || `发布失败（HTTP ${res.status}）`);
        return;
      }
      setSelected([]);
      setConfirming(null);
      setNotice(mode === "run" ? "已排队，本机发布任务会接着做。" : "已标记发布。");
      router.refresh();
    } catch {
      setError("网络异常，请重试");
    } finally {
      setBusy(false);
    }
  }

  const countLabel =
    total > items.length ? `显示最近 ${items.length} 条，共 ${total} 条` : `${total} 条`;

  return (
    <div>
      <div className="bb-bugs-toolbar">
          <select
            className="bb-select"
            style={{ width: "auto" }}
            value={filter}
            aria-label="变更筛选"
            onChange={(e) => {
              const next = e.target.value;
              router.push(
                next ? `/projects/${projectId}/changes?kind=${next}` : `/projects/${projectId}/changes`
              );
            }}
          >
            <option value="">全部</option>
            <option value="code">代码变更</option>
            <option value="release">发布</option>
          </select>
        {canRelease && !confirming ? (
          <div className="bb-bugs-actions">
            <button type="button" className="bb-btn" disabled={busy} onClick={() => setConfirming("run")}>
              立即发布
            </button>
            <button
              type="button"
              className="bb-btn bb-btn-secondary"
              disabled={busy}
              onClick={() => setConfirming("mark")}
            >
              标记已发布
            </button>
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="bb-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="bb-success" role="status">
          {notice}
        </p>
      ) : null}

      {canRelease && confirming ? (
        <div className="bb-card bb-section-card bb-change-confirm">
          <p>{confirmCopy(confirming, chosen.length, pendingBugs.length)}</p>
          <button
            type="button"
            className="bb-btn"
            disabled={busy}
            onClick={() => submit(confirming)}
          >
            {busy ? "提交中…" : confirming === "run" ? "确认立即发布" : "确认标记已发布"}
          </button>
          <button
            type="button"
            className="bb-btn bb-btn-secondary"
            disabled={busy}
            onClick={() => setConfirming(null)}
          >
            取消
          </button>
        </div>
      ) : null}

      {canRelease && pendingBugs.length > 0 ? (
        <section className="bb-card bb-section-card bb-change-pending" aria-labelledby="pending-release-heading">
          <h2 id="pending-release-heading">待发布报障</h2>
          <p className="bb-muted">
            勾选后只发布选中的报障。都不勾选则包含当前全部待发布报障。
          </p>
          <div className="bb-select bb-multi-select bb-change-checks">
            {pendingBugs.map((bug) => (
              <label key={bug.id} className="bb-multi-select-option">
                <input
                  type="checkbox"
                  checked={chosen.includes(bug.id)}
                  onChange={() => toggle(bug.id)}
                />
                <span>
                  {bug.publicId} {bug.title}
                </span>
              </label>
            ))}
          </div>
        </section>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          imageSrc="/brand/empty-bugs.png"
          title={filter ? "没有符合筛选的变更" : "暂无变更"}
          description={
            filter
              ? "换一个筛选，或查看全部记录。"
              : "修复推送和功能开发登记后，会出现在这里。"
          }
          action={
            filter ? (
              <Link href={`/projects/${projectId}/changes`} className="bb-btn bb-btn-secondary">
                查看全部
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <p className="bb-muted bb-bug-count">{countLabel}</p>
          <div className="bb-card bb-table-wrap">
            <table className="bb-table bb-change-table">
              <thead>
                <tr>
                  <th scope="col">时间</th>
                  <th scope="col">类型</th>
                  <th scope="col">标题</th>
                  <th scope="col">操作者</th>
                  <th scope="col">SHA</th>
                  <th scope="col">报障</th>
                  <th scope="col">上线</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="bb-muted bb-nowrap">
                      <HoverTip text={item.createdFull} always>
                        {item.createdLabel}
                      </HoverTip>
                    </td>
                    <td>
                      <span className={KIND_CLASS[item.kind]}>{item.kindLabel}</span>
                    </td>
                    <td className="bb-title-cell">
                      <div>{item.title}</div>
                      {item.note ? <div className="bb-change-note">{item.note}</div> : null}
                    </td>
                    <td>{item.actor}</td>
                    <td>
                      {item.shas.length === 0 ? (
                        <span className="bb-muted">—</span>
                      ) : (
                        <div className="bb-change-shas">
                          {item.shas.map((sha) =>
                            sha.href ? (
                              <a
                                key={sha.sha}
                                className="bb-bug-id bb-change-sha"
                                href={sha.href}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {sha.short}
                              </a>
                            ) : (
                              <span key={sha.sha} className="bb-muted bb-change-sha">
                                {sha.short}
                              </span>
                            )
                          )}
                        </div>
                      )}
                    </td>
                    <td>
                      {item.bugs.length === 0 ? (
                        <span className="bb-muted">—</span>
                      ) : (
                        <div className="bb-change-bugs">
                          {item.bugs.map((bug) =>
                            bug.href ? (
                              <Link key={bug.id} href={bug.href} className="bb-bug-id">
                                {bug.label}
                              </Link>
                            ) : (
                              <span key={bug.id} className="bb-muted">
                                {bug.label}
                              </span>
                            )
                          )}
                        </div>
                      )}
                    </td>
                    <td className="bb-nowrap">
                      <div className={toneClass(item.onlineTone)}>{item.onlineLabel}</div>
                      {item.onlineHint ? <div className="bb-change-note">{item.onlineHint}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function toneClass(tone: ChangeListItem["onlineTone"]) {
  if (tone === "ok") return "bb-change-ok";
  if (tone === "danger") return "bb-error";
  return "bb-muted";
}

function confirmCopy(mode: "run" | "mark", chosenCount: number, pendingCount: number) {
  const scope =
    chosenCount > 0
      ? `选中的 ${chosenCount} 条`
      : pendingCount > 0
        ? `全部 ${pendingCount} 条`
        : "";
  if (mode === "run") {
    if (!scope) return "确认立即发布？当前没有待发布报障，仍会排队一次发布。报障状态要等发布完成才变。";
    return `确认立即发布？将排队发布${scope}待发布报障。报障状态要等发布完成才变。`;
  }
  if (!scope) return "确认标记已发布？不会跑部署，会记一条发布记录。";
  return `确认标记已发布？不会跑部署。${scope}待发布报障会进入待确认。`;
}
