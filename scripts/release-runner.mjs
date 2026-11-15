#!/usr/bin/env node
/**
 * 宿主机发布任务。不在 Bugboard 进程里跑 git。
 *
 *   node scripts/release-runner.mjs              领走已排队的发布
 *   node scripts/release-runner.mjs --project=SOC
 *   node scripts/release-runner.mjs --schedule   按上海时间入队到期项目，再领走队列
 *
 * 配置在 wake.config.json：bugboardUrl、releaseKey、projects[缩写或 slug]。
 * 环境变量 BUGBOARD_URL、BUGBOARD_RELEASE_KEY 可覆盖。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIRTY = "工作区有未提交改动";
const DIVERGED = "本地与远端已经分叉，需要人工处理";
const UNKNOWN = "无法判断 Git 状态";
const SHELLS = new Set([
  "sh",
  "bash",
  "zsh",
  "fish",
  "dash",
  "ksh",
  "csh",
  "tcsh",
  "osascript",
  "python",
  "python3",
  "node",
  "perl",
  "ruby",
]);
const DEPLOY_ROOTS = ["/Users", "/opt", "/usr", "/homebrew"];
const SAFE_DEPLOY_PATH = /^\/(?:[\w.+@-]{1,80}\/)*[\w.+@-]{1,120}$/;

export function planGitSync(input) {
  if (input.dirty) return { action: "abort", reason: DIRTY };
  const { ahead, behind } = input;
  if (!Number.isInteger(ahead) || !Number.isInteger(behind) || ahead < 0 || behind < 0) {
    return { action: "abort", reason: UNKNOWN };
  }
  if (behind > 0 && ahead === 0) return { action: "ff_pull" };
  if (ahead > 0 && behind === 0) return { action: "push" };
  // 分叉需要人工处理。ahead > 0 时 HEAD 不可能是远端祖先，不能靠 merge-base 区分已推送分叉，所以不自动 rebase。
  if (ahead > 0 && behind > 0) return { action: "abort", reason: DIVERGED };
  if (ahead === 0 && behind === 0) return { action: "up_to_date" };
  return { action: "abort", reason: UNKNOWN };
}

/** One absolute executable. No shell, pipeline, or `bash -c`. Workspace may hold the script. */
export function assertDeployExecutable(command, workspace) {
  const text = String(command || "").trim();
  if (!text || text.length > 400 || /[\s\r\n\0|&;<>`$(){}[\]!#*?~\\'"]/.test(text) || text.includes("..")) {
    throw new Error("发布命令必须是绝对路径，不能包含管道或 shell");
  }
  if (!SAFE_DEPLOY_PATH.test(text)) throw new Error("发布命令必须是绝对路径，不能包含管道或 shell");
  const base = text.split("/").pop() || "";
  if (SHELLS.has(base)) throw new Error("发布命令不能是 shell");
  const resolved = path.resolve(text);
  const roots = [...DEPLOY_ROOTS];
  if (workspace && String(workspace).trim()) roots.push(path.resolve(workspace));
  const allowed = roots.some((root) => resolved.startsWith(`${root}${path.sep}`));
  if (!allowed) throw new Error("发布命令必须放在 /Users、/opt、/usr 或工作区里");
  return text;
}

export function deploySpawnPlan(command, workspace) {
  return { cmd: assertDeployExecutable(command, workspace), args: [], shell: false };
}

export function parseAheadBehind(output) {
  const match = String(output || "").trim().match(/^(\d+)\t(\d+)$/);
  if (!match) return null;
  return { behind: Number(match[1]), ahead: Number(match[2]) };
}

export function parseDirty(porcelain) {
  return String(porcelain || "")
    .split("\n")
    .some((line) => line.trim().length > 0);
}

function canonicalRemote(raw) {
  const value = String(raw || "").trim();
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

function originsMatch(originUrl, githubUrl) {
  const origin = canonicalRemote(originUrl);
  const github = canonicalRemote(githubUrl);
  return Boolean(origin) && origin === github;
}

function assertBranch(branch) {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(branch) ||
    branch.includes("..") ||
    branch.endsWith("/") ||
    branch.includes("//")
  ) {
    throw new Error("分支名无效");
  }
  return branch;
}

export function gitSteps(action, branch) {
  const name = assertBranch(branch);
  if (action === "ff_pull") return [["pull", "--ff-only", "origin", name]];
  if (action === "push") return [["push", "origin", "HEAD"]];
  if (action === "up_to_date" || action === "abort") return [];
  throw new Error(UNKNOWN);
}

export function shanghaiHHMM(date) {
  const clock = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return `${String(clock.getUTCHours()).padStart(2, "0")}:${String(clock.getUTCMinutes()).padStart(2, "0")}`;
}

export function parseRunnerArgs(argv) {
  const args = { schedule: false, project: "", at: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i];
    if (part === "--schedule") args.schedule = true;
    else if (part === "--project") args.project = argv[(i += 1)] || "";
    else if (part.startsWith("--project=")) args.project = part.slice("--project=".length);
    else if (part === "--at") args.at = argv[(i += 1)] || "";
    else if (part.startsWith("--at=")) args.at = part.slice("--at=".length);
    else throw new Error(`不认识的参数：${part}`);
  }
  return args;
}

export function readReleaseConfig(env = process.env, cwd = process.cwd()) {
  const file = path.resolve(cwd, "wake.config.json");
  let fromFile = {};
  if (fs.existsSync(file)) fromFile = JSON.parse(fs.readFileSync(file, "utf8"));
  const projects = fromFile.projects && typeof fromFile.projects === "object" ? fromFile.projects : {};
  return {
    bugboardUrl: String(env.BUGBOARD_URL || fromFile.bugboardUrl || "http://127.0.0.1:3080").replace(/\/$/, ""),
    releaseKey: String(env.BUGBOARD_RELEASE_KEY || fromFile.releaseKey || "").trim(),
    projects,
  };
}

function clip(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 180);
}

function workspaceFor(projects, job) {
  const value = projects?.[job.code] || projects?.[job.slug] || "";
  return typeof value === "string" ? value.trim() : "";
}

function failed(detail) {
  return { result: "failed", detail: clip(detail) || "发布失败" };
}

async function executeJob(job, config, { git, exec, stat }) {
  if (job.deployMode === "none") return failed("该项目不自动部署");
  if (job.deployMode !== "restart" && job.deployMode !== "ecs_deploy") return failed("发布方式无效");
  const rawCommand = String(job.deployCommand || "").trim();
  if (!rawCommand) return failed("没有发布命令");

  const dir = workspaceFor(config.projects, job);
  const looked = dir ? stat(dir) : { exists: false, isDirectory: false };
  if (!looked.exists || !looked.isDirectory) return failed("工作区不存在");

  let deployCommand;
  try {
    deployCommand = assertDeployExecutable(rawCommand, dir);
  } catch (error) {
    return failed(error instanceof Error ? error.message : "发布命令无效");
  }

  const inside = git(dir, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.code !== 0 || inside.stdout.trim() !== "true") return failed("工作区不是 git 仓库");
  const origin = git(dir, ["remote", "get-url", "origin"]);
  if (origin.code !== 0 || !originsMatch(origin.stdout, job.githubUrl)) {
    return failed("origin 与代码仓地址不一致");
  }

  const expectedRaw = String(job.defaultBranch || "").trim();
  if (!expectedRaw) return failed("项目没有默认分支");
  const headName = git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (headName.code !== 0) return failed("无法判断当前分支");
  let branch;
  let current;
  try {
    branch = assertBranch(expectedRaw);
    current = assertBranch(headName.stdout.trim());
  } catch (error) {
    return failed(error instanceof Error ? error.message : "分支名无效");
  }
  if (current !== branch) return failed("当前分支不是项目默认分支");

  const fetched = git(dir, ["fetch", "origin"]);
  if (fetched.code !== 0) return failed(fetched.stderr || "git fetch 失败");

  const porcelain = git(dir, ["status", "--porcelain"]);
  if (porcelain.code !== 0) return failed("无法判断 Git 状态");
  const counts = git(dir, ["rev-list", "--left-right", "--count", `origin/${branch}...HEAD`]);
  if (counts.code !== 0) return failed("无法比较远端分支");
  const parsed = parseAheadBehind(counts.stdout);
  if (!parsed) return failed(UNKNOWN);
  const plan = planGitSync({
    dirty: parseDirty(porcelain.stdout),
    ahead: parsed.ahead,
    behind: parsed.behind,
  });
  if (plan.action === "abort") return failed(plan.reason);

  for (const args of gitSteps(plan.action, branch)) {
    const step = git(dir, args);
    if (step.code !== 0) return failed(step.stderr || `git ${args[0]} 失败`);
  }

  const head = git(dir, ["rev-parse", "HEAD"]);
  const headSha = head.stdout.trim();
  if (head.code !== 0 || !/^[0-9a-f]{7,64}$/i.test(headSha)) return failed("读不到当前提交");

  const deployed = exec(deployCommand, dir);
  if (deployed.code !== 0) return failed(deployed.stderr || deployed.stdout || "发布命令失败");
  return { result: "success", headSha, detail: "" };
}

export async function runReleasePass({ config, args, now = new Date(), request, git, exec, stat }) {
  if (!config?.bugboardUrl || !config?.releaseKey) {
    throw new Error("wake.config.json 里要有 bugboardUrl 和 releaseKey，或设置 BUGBOARD_URL / BUGBOARD_RELEASE_KEY");
  }
  const call = request || ((body) => postRunner(config, body));
  const runGit = git || defaultGit;
  const runExec = exec || defaultExec;
  const look = stat || defaultStat;
  if (args.schedule) {
    await call({ op: "schedule", at: args.at || shanghaiHHMM(now) });
  }
  let ran = 0;
  let failedCount = 0;
  for (let i = 0; i < 20; i += 1) {
    const claim = { op: "claim" };
    if (args.project) claim.project = args.project;
    const data = await call(claim);
    if (!data?.job) break;
    ran += 1;
    const outcome = await executeJob(data.job, config, { git: runGit, exec: runExec, stat: look });
    if (outcome.result !== "success") failedCount += 1;
    await call({
      op: "finish",
      dispatchId: data.job.dispatchId,
      result: outcome.result,
      headSha: outcome.headSha,
      detail: outcome.detail,
    });
  }
  return { ran, failed: failedCount };
}

function defaultStat(dir) {
  try {
    const info = fs.statSync(dir);
    return { exists: true, isDirectory: info.isDirectory() };
  } catch {
    return { exists: false, isDirectory: false };
  }
}

function defaultGit(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 120000 });
  return {
    code: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || result.error?.message || "",
  };
}

function defaultExec(command, cwd) {
  let plan;
  try {
    plan = deploySpawnPlan(command, cwd);
  } catch (error) {
    return {
      code: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : "发布命令无效",
    };
  }
  const result = spawnSync(plan.cmd, plan.args, {
    cwd,
    encoding: "utf8",
    shell: plan.shell,
    timeout: 600000,
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || result.error?.message || "",
  };
}

async function postRunner(config, body) {
  const res = await fetch(`${config.bugboardUrl}/api/releases/runner`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.releaseKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!res.ok) {
    const message = typeof data.error === "string" && data.error.trim() ? data.error.trim() : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return data;
}

async function main() {
  const config = readReleaseConfig();
  const args = parseRunnerArgs(process.argv.slice(2));
  const result = await runReleasePass({ config, args });
  const ok = result.ran - result.failed;
  console.log(result.ran ? `发布完成 ${ok} 个，失败 ${result.failed} 个` : "没有排队的发布任务");
  if (result.failed) process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "发布失败");
    process.exit(1);
  });
}
