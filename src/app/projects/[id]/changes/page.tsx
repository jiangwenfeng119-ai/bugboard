import { normalizeRepoUrl } from "@/lib/dispatch";
import { getDb } from "@/lib/db";
import { isProjectAdmin } from "@/lib/permissions";
import { listChanges } from "@/lib/project-changes";
import { listPendingRelease } from "@/lib/release";
import { getProject, resolveActorLabel } from "@/lib/services";
import { requireUser } from "@/lib/session-guard";
import { formatDateTime, formatDateTimeShort } from "@/lib/time";
import type {
  ActorType,
  ProjectChangeKind,
  ProjectChangeRow,
  ReleaseTrigger,
} from "@/lib/types";
import {
  ChangesPanel,
  type ChangeListItem,
  type PendingReleaseBug,
  type ReleaseFeedback,
} from "./ChangesPanel";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<ProjectChangeKind, string> = {
  fix: "修复",
  feature: "功能",
  chore: "杂项",
  release: "发布",
};

const TRIGGER_LABEL: Record<ReleaseTrigger, string> = {
  scheduled: "定时",
  manual: "紧急",
  external: "外部标记",
};

export default async function ChangesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ kind?: string }>;
}) {
  const identity = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const projectId = Number(id);
  const project = getProject(identity, projectId);
  const filter = sp.kind === "code" || sp.kind === "release" ? sp.kind : "";
  const { changes, total } = listChanges(identity, projectId, {
    kind: filter || undefined,
    limit: 100,
  });
  const canRelease = isProjectAdmin(identity, projectId);
  const pending = canRelease ? listPendingRelease(identity, projectId) : null;
  const bugIds = changes.flatMap((change) => change.bug_ids);
  const publicIds = lookupPublicIds(projectId, bugIds);
  const actors = new Map<string, string>();
  const repo = normalizeRepoUrl(project.github_url || "");

  const items = changes.map((change) =>
    toListItem(change, repo, publicIds, (type, actorId) => {
      const key = `${type}:${actorId}`;
      const cached = actors.get(key);
      if (cached) return cached;
      const label = resolveActorLabel(type, actorId);
      actors.set(key, label);
      return label;
    })
  );

  const pendingBugs: PendingReleaseBug[] = (pending?.bugs ?? []).map((bug) => ({
    id: bug.id,
    publicId: bug.public_id,
    title: bug.title,
  }));
  const releaseFeedback: ReleaseFeedback = pending?.releaseFeedback ?? {
    activeStatus: null,
    latestFailureDetail: null,
    advancesBugs: true,
  };

  return (
    <div className="bb-bugs-page">
      <p className="bb-muted bb-change-lead">本项目的代码变更和发布记录。</p>
      <ChangesPanel
        projectId={projectId}
        filter={filter}
        items={items}
        total={total}
        canRelease={canRelease}
        pendingBugs={pendingBugs}
        releaseFeedback={releaseFeedback}
      />
    </div>
  );
}

function toListItem(
  change: ProjectChangeRow,
  repo: string,
  publicIds: Map<number, string>,
  actorLabel: (type: ActorType, id: number) => string
): ChangeListItem {
  const online = onlineOf(change);
  return {
    id: change.id,
    kind: change.kind,
    kindLabel: KIND_LABEL[change.kind],
    title: change.title,
    note: changeNote(change),
    actor: actorLabel(change.actor_type, change.actor_id),
    createdLabel: formatDateTimeShort(change.created_at),
    createdFull: formatDateTime(change.created_at),
    shas: change.commit_shas.flatMap((raw) => {
      const sha = raw.trim();
      if (!sha) return [];
      return [
        {
          sha,
          short: sha.slice(0, 7),
          href: repo ? `${repo}/commit/${encodeURIComponent(sha)}` : null,
        },
      ];
    }),
    bugs: change.bug_ids.map((bugId) => {
      const publicId = publicIds.get(bugId);
      return {
        id: bugId,
        label: publicId || `#${bugId}`,
        href: publicId ? `/bugs/${bugId}` : null,
      };
    }),
    onlineLabel: online.label,
    onlineTone: online.tone,
    onlineHint: online.hint,
  };
}

function onlineOf(change: ProjectChangeRow): {
  label: string;
  tone: ChangeListItem["onlineTone"];
  hint: string | null;
} {
  if (change.kind === "release") {
    const hint = change.trigger ? TRIGGER_LABEL[change.trigger] : null;
    if (change.result === "failed") return { label: "失败", tone: "danger", hint };
    if (change.result === "success") return { label: "成功", tone: "ok", hint };
    return { label: "—", tone: "muted", hint };
  }
  if (change.release_change_id) return { label: "已上线", tone: "ok", hint: null };
  return { label: "未上线", tone: "muted", hint: null };
}

function changeNote(change: ProjectChangeRow) {
  const summary = change.summary?.trim() || "";
  const detail = change.detail?.trim() || "";
  if (change.kind === "release") return detail || summary || null;
  if (summary && detail && summary !== detail) return `${summary} ${detail}`;
  return summary || detail || null;
}

function lookupPublicIds(projectId: number, ids: number[]) {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  const map = new Map<number, string>();
  if (unique.length === 0) return map;
  const placeholders = unique.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT id, public_id FROM bugs WHERE project_id = ? AND id IN (${placeholders})`
    )
    .all(projectId, ...unique) as { id: number; public_id: string }[];
  for (const row of rows) map.set(row.id, row.public_id);
  return map;
}
