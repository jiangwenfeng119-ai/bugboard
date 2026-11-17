import { createHmac } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  askEnv,
  askGitSteps,
  buildAskArgv,
  callbackAllowed,
  parseAskStreamLine,
  planAskMirror,
} from "./ask-protocol.mjs";

const chains = new Map();

function sign(secret, body) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function enqueueAsk(key, job) {
  const prev = chains.get(key) || Promise.resolve();
  const next = prev.then(job, job);
  chains.set(key, next);
  return next.finally(() => {
    if (chains.get(key) === next) chains.delete(key);
  });
}

export function gitSync(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || result.error?.message || "",
  };
}

export function inspectAskMirror(dir, git = gitSync) {
  if (!fs.existsSync(dir)) {
    return { exists: false, isGit: false, originUrl: "", dirty: false, ahead: 0, behind: 0, headBranch: "" };
  }
  const inside = git(dir, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.code !== 0 || inside.stdout.trim() !== "true") {
    return { exists: true, isGit: false, originUrl: "", dirty: false, ahead: 0, behind: 0, headBranch: "" };
  }
  const origin = git(dir, ["remote", "get-url", "origin"]);
  const branch = git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const porcelain = git(dir, ["status", "--porcelain"]);
  const headBranch = branch.code === 0 ? branch.stdout.trim() : "";
  let ahead = 0;
  let behind = 0;
  if (headBranch && headBranch !== "HEAD") {
    const counts = git(dir, ["rev-list", "--left-right", "--count", `origin/${headBranch}...HEAD`]);
    const match = counts.stdout.trim().match(/^(\d+)\t(\d+)$/);
    if (counts.code === 0 && match) {
      behind = Number(match[1]);
      ahead = Number(match[2]);
    }
  }
  return {
    exists: true,
    isGit: true,
    originUrl: origin.code === 0 ? origin.stdout.trim() : "",
    dirty: porcelain.stdout.split("\n").some((line) => line.trim()),
    ahead,
    behind,
    headBranch,
  };
}

export function assertAskRoot(root) {
  if (!root || typeof root !== "string") throw new Error("没有配置问答目录 askRoot");
  const abs = path.resolve(root);
  fs.mkdirSync(abs, { recursive: true });
  const real = fs.realpathSync(abs);
  const home = fs.realpathSync(os.homedir());
  if (real === home || real === path.parse(real).root) throw new Error("问答目录不能是用户主目录或磁盘根目录");
  if (fs.existsSync(path.join(real, "wake.config.json"))) throw new Error("问答目录里不能放叫醒配置");
  return real;
}

function runSteps(steps, git) {
  for (const step of steps) {
    const result = git(step.cwd, step.args);
    if (!result || result.code !== 0) {
      throw new Error(String(result?.stderr || result?.stdout || "同步代码失败").trim().slice(0, 300));
    }
  }
}

export function syncAskMirror(input, git = gitSync) {
  const facts = inspectAskMirror(input.dir, git);
  const first = planAskMirror({
    githubUrl: input.githubUrl,
    defaultBranch: input.defaultBranch,
    ...facts,
    ahead: 0,
    behind: 0,
    dirty: false,
  });
  if (first.action === "refuse") throw new Error(first.reason);
  if (first.action === "clone") {
    runSteps(askGitSteps(first, input.dir, input.askRoot), git);
    return finishSha(input.dir, git, first.branch);
  }
  const fetched = git(input.dir, ["fetch", "origin"]);
  if (!fetched || fetched.code !== 0) {
    throw new Error(String(fetched?.stderr || "git fetch 失败").trim().slice(0, 300));
  }
  const after = inspectAskMirror(input.dir, git);
  const plan = planAskMirror({
    githubUrl: input.githubUrl,
    defaultBranch: input.defaultBranch,
    ...after,
  });
  if (plan.action === "refuse") throw new Error(plan.reason);
  if (plan.action !== "ready") {
    runSteps(
      askGitSteps(plan, input.dir, input.askRoot).filter((step) => step.args[0] !== "fetch"),
      git
    );
  }
  return finishSha(input.dir, git, plan.branch || after.headBranch);
}

function finishSha(dir, git, branch) {
  const head = git(dir, ["rev-parse", "HEAD"]);
  const sha = String(head?.stdout || "").trim();
  if (!head || head.code !== 0 || !/^[0-9a-f]{7,64}$/i.test(sha)) throw new Error("读不到当前提交");
  return { sha, branch: branch || "" };
}

export function mirrorHasMcp(dir) {
  return fs.existsSync(path.join(dir, ".cursor", "mcp.json")) || fs.existsSync(path.join(dir, "mcp.json"));
}

function spawnAgent(command, args, cwd, env) {
  return spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
}

function readAgent(child, onLine) {
  return new Promise((resolve, reject) => {
    let buf = "";
    let stderr = "";
    let aborted = false;
    const timer = setTimeout(() => {
      aborted = true;
      child.kill("SIGTERM");
    }, 4 * 60 * 1000);
    child.stdout?.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (onLine(line) === "abort") {
          aborted = true;
          child.kill("SIGTERM");
        }
      }
    });
    child.stderr?.on("data", (chunk) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4000);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (buf.trim()) onLine(buf);
      resolve({ code: code ?? 1, stderr, aborted });
    });
  });
}

async function postCallback(config, payload, event, post) {
  const secret = config.secrets?.[0];
  if (!secret) throw new Error("没有签名密钥");
  const body = JSON.stringify({ runId: payload.runId, ...event });
  return post(payload.callbackUrl, body, sign(secret, body));
}

export function syncConfiguredMirrors(config, projects, git = gitSync) {
  const askRoot = assertAskRoot(config.askRoot);
  const synced = [];
  for (const project of projects) {
    const code = String(project?.code || "");
    if (!project?.githubUrl || !/^[A-Z][A-Z0-9]{1,7}$/.test(code)) continue;
    const dir = path.join(askRoot, code);
    try {
      const result = syncAskMirror(
        { dir, askRoot, githubUrl: project.githubUrl, defaultBranch: project.defaultBranch || "" },
        git
      );
      synced.push({ code, sha: result.sha });
    } catch (error) {
      synced.push({ code, error: error instanceof Error ? error.message : "同步失败" });
    }
  }
  return synced;
}

export async function executeAsk(config, payload, deps = {}) {
  const git = deps.git || gitSync;
  const post =
    deps.post ||
    (async (url, body, signature) => {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Bugboard-Signature": `sha256=${signature}`,
        },
        body,
        redirect: "error",
      });
      const json = await res.json().catch(() => ({}));
      return { status: res.status, json };
    });
  const launch = deps.spawnAgent || spawnAgent;
  if (!callbackAllowed(payload.callbackUrl, config.bugboardUrl || "")) {
    throw new Error("回调地址无效");
  }
  let seq = 0;
  const send = async (event) => {
    seq += 1;
    return postCallback(config, payload, { seq, ...event }, post);
  };
  const code = String(payload.project?.code || "");
  if (!/^[A-Z][A-Z0-9]{1,7}$/.test(code)) {
    await send({ kind: "failed", text: "项目缩写无效" }).catch(() => {});
    return { error: "项目缩写无效" };
  }
  try {
    const askRoot = assertAskRoot(config.askRoot);
    const dir = path.join(askRoot, code);
    await send({ kind: "status", text: "正在从远端同步代码" });
    const synced = syncAskMirror(
      {
        dir,
        askRoot,
        githubUrl: payload.project?.githubUrl || "",
        defaultBranch: payload.project?.defaultBranch || "",
      },
      git
    );
    if (mirrorHasMcp(dir)) throw new Error("问答目录里有 MCP 配置，已拒绝启动");
    const probe = await send({ kind: "probe", mirrorSha: synced.sha, text: "" });
    if (probe?.json?.skip) return { skipped: true, sha: synced.sha };
    const prompt = String(payload.prompt || "");
    if (!prompt.trim()) throw new Error("缺少问题");
    const args = buildAskArgv({ cwd: dir, prompt, sessionId: payload.sessionId || "" });
    let answer = "";
    let sessionId = "";
    let wrote = false;
    let pending = "";
    let flushTimer = null;
    const flush = async () => {
      if (!pending) return;
      const text = pending;
      pending = "";
      await send({ kind: "delta", text, mirrorSha: synced.sha });
    };
    const child = launch(args[0], args.slice(1), dir, askEnv(deps.env || process.env));
    const finished = await readAgent(child, (line) => {
      const parsed = parseAskStreamLine(line);
      if (parsed.kind === "write") {
        wrote = true;
        return "abort";
      }
      if (parsed.kind === "text") {
        answer += parsed.text;
        pending += parsed.text;
        if (!flushTimer) {
          flushTimer = setTimeout(() => {
            flushTimer = null;
            void flush();
          }, 200);
        }
      }
      if (parsed.kind === "status") void send({ kind: "status", text: parsed.text, mirrorSha: synced.sha });
      if (parsed.sessionId) sessionId = parsed.sessionId;
      if (parsed.kind === "result" && parsed.text) answer = parsed.text;
      return "";
    });
    if (flushTimer) clearTimeout(flushTimer);
    await flush();
    if (wrote || finished.aborted) {
      runSteps(
        askGitSteps({ action: "reset", branch: synced.branch }, dir, askRoot).filter((step) => step.args[0] !== "fetch"),
        git
      );
      await send({
        kind: wrote ? "reverted" : "failed",
        text: wrote ? "这次没有回答。代码没有被改动。" : "回答超时",
        mirrorSha: synced.sha,
      });
      return { reverted: wrote };
    }
    const after = inspectAskMirror(dir, git);
    const head = git(dir, ["rev-parse", "HEAD"]);
    const sha = String(head?.stdout || "").trim();
    if (after.dirty || sha !== synced.sha) {
      runSteps(
        askGitSteps({ action: "reset", branch: synced.branch }, dir, askRoot).filter((step) => step.args[0] !== "fetch"),
        git
      );
      await send({ kind: "reverted", text: "这次没有回答。代码没有被改动。", mirrorSha: synced.sha });
      return { reverted: true };
    }
    if (!answer.trim()) throw new Error(finished.stderr.trim().slice(0, 300) || "没有得到回答");
    await send({ kind: "done", text: answer, sessionId, mirrorSha: synced.sha });
    return { sha: synced.sha, sessionId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "没有得到回答";
    await send({ kind: "failed", text: message.slice(0, 300) }).catch(() => {});
    return { error: message };
  }
}
