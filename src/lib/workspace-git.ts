export type GitSyncPlan =
  | { action: "ff_pull" }
  | { action: "push" }
  | { action: "up_to_date" }
  | { action: "abort"; reason: string };

const DIRTY = "工作区有未提交改动";
const DIVERGED = "本地与远端已经分叉，需要人工处理";
const UNKNOWN = "无法判断 Git 状态";

/** Decide how a clean release may sync with origin. Does not run git. */
export function planGitSync(input: {
  dirty: boolean;
  ahead: number;
  behind: number;
}): GitSyncPlan {
  if (input.dirty) return { action: "abort", reason: DIRTY };
  const { ahead, behind } = input;
  if (!Number.isInteger(ahead) || !Number.isInteger(behind) || ahead < 0 || behind < 0) {
    return { action: "abort", reason: UNKNOWN };
  }
  if (behind > 0 && ahead === 0) return { action: "ff_pull" };
  if (ahead > 0 && behind === 0) return { action: "push" };
  // Divergent histories need a human. Auto-rebase is out: ahead > 0 already
  // means HEAD is not an ancestor of origin, so that check cannot detect a diverge.
  if (ahead > 0 && behind > 0) return { action: "abort", reason: DIVERGED };
  if (ahead === 0 && behind === 0) return { action: "up_to_date" };
  return { action: "abort", reason: UNKNOWN };
}

/** `git rev-list --left-right --count origin/branch...HEAD` → behind, ahead. */
export function parseAheadBehind(output: string): { ahead: number; behind: number } | null {
  const match = output.trim().match(/^(\d+)\t(\d+)$/);
  if (!match) return null;
  return { behind: Number(match[1]), ahead: Number(match[2]) };
}

export function parseDirty(porcelain: string) {
  return porcelain.split("\n").some((line) => line.trim().length > 0);
}

function canonicalRemote(raw: string) {
  const value = raw.trim();
  if (!value) return "";
  const ssh = value.match(/^git@([^:/\s]+):([^/\s].*)$/i);
  if (ssh) {
    const host = ssh[1].toLowerCase();
    const pathName = ssh[2].replace(/\.git$/i, "").replace(/\/+$/, "").replace(/^\/+/, "");
    return `${host}/${pathName}`.toLowerCase();
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    const pathName = url.pathname.replace(/\.git$/i, "").replace(/\/+$/, "").replace(/^\/+/, "");
    return `${url.hostname.toLowerCase()}/${pathName}`.toLowerCase();
  } catch {
    return "";
  }
}

export function originsMatch(originUrl: string, githubUrl: string) {
  const origin = canonicalRemote(originUrl);
  const github = canonicalRemote(githubUrl);
  return Boolean(origin) && origin === github;
}

export function workspaceHealth(input: {
  exists: boolean;
  isDirectory: boolean;
  isGit: boolean;
  originUrl: string;
  githubUrl: string;
}): { ok: true } | { ok: false; reason: string } {
  if (!input.exists || !input.isDirectory) return { ok: false, reason: "工作区不存在" };
  if (!input.isGit) return { ok: false, reason: "工作区不是 git 仓库" };
  if (!originsMatch(input.originUrl, input.githubUrl)) {
    return { ok: false, reason: "origin 与代码仓地址不一致" };
  }
  return { ok: true };
}
