"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { HoverTip } from "@/components/HoverTip";
import {
  canImmediateRelease,
  releaseFinishedNotice,
  releaseStatusBanner,
  releaseSubmitNotice,
} from "@/lib/release-ui";
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

export type ReleaseFeedback = {
  activeStatus: "queued" | "running" | null;
  latestFailureDetail: string | null;
  advancesBugs: boolean;
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
  releaseFeedback,
}: {
  projectId: number;
  filter: "" | "code" | "release";
  items: ChangeListItem[];
  total: number;
  canRelease: boolean;
  pendingBugs: PendingReleaseBug[];
  releaseFeedback: ReleaseFeedback;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<number[]>([]);
  const [confirming, setConfirming] = useState<null | "run" | "mark">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [feedback, setFeedback] = useState(releaseFeedback);

  useEffect(() => {
    setFeedback(releaseFeedback);
  }, [releaseFeedback]);

  const jobInFlight = feedback.activeStatus === "queued" || feedback.activeStatus === "running";

  useEffect(() => {
    if (!canRelease || !jobInFlight) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/release`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { releaseFeedback?: ReleaseFeedback };
        if (!data.releaseFeedback || cancelled) return;
        setFeedback(data.releaseFeedback);
        const stillActive =
          data.releaseFeedback.activeStatus === "queued" ||
          data.releaseFeedback.activeStatus === "running";
        if (!stillActive) {
          setNotice(
            data.releaseFeedback.latestFailureDetail
              ? ""
              : releaseFinishedNotice(data.releaseFeedback.advancesBugs)
          );
          router.refresh();
        }
      } catch {
        // Keep the last known banner; next tick retries.
      }
    };
    const id = window.setInterval(tick, 3000);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [canRelease, jobInFlight, projectId, router]);

  const pendingIds = new Set(pendingBugs.map((bug) => bug.id));
  const chosen = selected.filter((id) => pendingIds.has(id));
  const canRunRelease = canImmediateRelease(pendingBugs.length, jobInFlight);
  const banner = canRelease
    ? releaseStatusBanner({
        activeStatus: feedback.activeStatus,
        latestFailureDetail: feedback.latestFailureDetail,
        advancesBugs: feedback.advancesBugs,
      })
    : null;

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
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        releaseFeedback?: ReleaseFeedback;
      };
      if (!res.ok) {
        setError(data.error || `发布失败（HTTP ${res.status}）`);
        return;
      }
      setSelected([]);
      setConfirming(null);
      setNotice(releaseSubmitNotice(mode, feedback.advancesBugs));
      if (mode === "run") {
        setFeedback((prev) => ({
          ...prev,
          activeStatus: "queued",
          latestFailureDetail: null,
        }));
      } else {
        setFeedback((prev) => ({
          ...prev,
          activeStatus: null,
          latestFailureDetail: null,
        }));
      }
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
            <button
              type="button"
              className={canRunRelease ? "bb-btn" : "bb-btn bb-btn-secondary"}
              disabled={busy || !canRunRelease}
              title={
                jobInFlight
                  ? "已有发布任务在排队或执行，结束后才能再次发布。"
                  : canRunRelease
                    ? undefined
                    : "眼下还没有待发布报障。有待发单时再点这里。"
              }
              onClick={() => setConfirming("run")}
            >
              {feedback.activeStatus === "running"
                ? "发布执行中…"
                : feedback.activeStatus === "queued"
                  ? "发布排队中…"
                  : "立即发布"}
            </button>
            <button
              type="button"
              className="bb-btn bb-btn-secondary"
              disabled={busy || jobInFlight}
              title={jobInFlight ? "已有发布任务在排队或执行。" : undefined}
              onClick={() => setConfirming("mark")}
            >
              {jobInFlight ? "发布进行中…" : "标记已发布"}
            </button>
          </div>
        ) : null}
        {canRelease && !canRunRelease && !confirming && !jobInFlight ? (
          <p className="bb-muted" style={{ margin: "0.35rem 0 0", width: "100%" }}>
            眼下还没有待发布的报障。修好并提交说明后，再回这里一键发布就行；若已经在外面发完，也可以用「标记已发布」记一笔。
          </p>
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
      {banner ? (
        <div
          className={
            banner.tone === "danger" ? "bb-change-banner bb-change-banner-danger" : "bb-change-banner"
          }
          role={banner.tone === "danger" ? "alert" : "status"}
        >
          <strong>{banner.title}</strong>
          <p>{banner.body}</p>
        </div>
      ) : null}

      {canRelease && confirming ? (
        <div className="bb-card bb-section-card bb-change-confirm">
          <p>{confirmCopy(confirming, chosen.length, pendingBugs.length, feedback.advancesBugs)}</p>
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
              : canRelease
                ? "修好并提交修复说明后，待发布报障会出现在上方；发布或登记后，时间线会落在这里。"
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

function confirmCopy(
  mode: "run" | "mark",
  chosenCount: number,
  pendingCount: number,
  advancesBugs: boolean
) {
  const scope =
    chosenCount > 0
      ? `选中的 ${chosenCount} 条`
      : pendingCount > 0
        ? `全部 ${pendingCount} 条`
        : "";
  if (mode === "run") {
    const statusLine = advancesBugs
      ? "成功后对应报障进入待确认；失败则留在待发布，本页会显示失败原因，可重新发布。"
      : "完成后变更列表会记发布结果；失败时本页会显示原因，可重新发布。";
    if (!scope) {
      return `确认立即发布？当前没有待发布报障，仍会排队一次发布。${statusLine}`;
    }
    return `确认立即发布？将排队发布${scope}待发布报障。${statusLine}`;
  }
  if (!scope) {
    return advancesBugs
      ? "确认标记已发布？不会跑部署，会记一条发布记录。"
      : "确认标记已发布？不会跑部署，会记一条发布记录。";
  }
  return advancesBugs
    ? `确认标记已发布？不会跑部署。${scope}待发布报障会进入待确认。`
    : `确认标记已发布？不会跑部署。会记一条发布记录（含${scope}待发布报障）。`;
}
