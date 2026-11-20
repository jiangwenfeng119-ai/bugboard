import { createHmac } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendDeepBrief,
  askEnv,
  askGitSteps,
  askSearchTerms,
  buildAskArgv,
  callbackAllowed,
  chooseAskPath,
  collectAskHits,
  documentsFromPrompt,
  draftAskAnswer,
  fallbackAskAnswer,
  withFilingAdvice,
  featureMapFromPrompt,
  isFeatureMapPrompt,
  parseAskStreamLine,
  planAskMirror,
  questionFromPrompt,
  headingLabels,
  phraseLabels,
  screenLines,
} from "./ask-protocol.mjs";

const userChains = new Map();
const mapChains = new Map();

function sign(secret, body) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function enqueueAsk(key, job, lane = "user") {
  if (lane === "map") {
    const prevUser = userChains.get(key) || Promise.resolve();
    const prevMap = mapChains.get(key) || Promise.resolve();
    const next = Promise.all([prevUser, prevMap]).then(job, job);
    mapChains.set(key, next);
    return next.finally(() => {
      if (mapChains.get(key) === next) mapChains.delete(key);
    });
  }
  const prev = userChains.get(key) || Promise.resolve();
  const next = prev.then(job, job);
  userChains.set(key, next);
  return next.finally(() => {
    if (userChains.get(key) === next) userChains.delete(key);
  });
}

export function gitSync(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 12000,
    killSignal: "SIGKILL",
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

export const ASK_FETCH_FRESH_MS = 90_000;

export function fetchHeadAge(dir, now = Date.now()) {
  try {
    return now - fs.statSync(path.join(dir, ".git", "FETCH_HEAD")).mtimeMs;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function syncAskMirror(input, git = gitSync, now = Date.now()) {
  const facts = inspectAskMirror(input.dir, git);
  if (facts.exists && facts.isGit && fetchHeadAge(input.dir, now) < ASK_FETCH_FRESH_MS) {
    const cached = planAskMirror({
      githubUrl: input.githubUrl,
      defaultBranch: input.defaultBranch,
      ...facts,
    });
    if (cached.action === "ready") return finishSha(input.dir, git, cached.branch || facts.headBranch);
  }
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

function addInterfaceFile(files, full) {
  if (files.includes(full) || !/\.(ts|tsx)$/.test(full)) return;
  try {
    if (fs.statSync(full).isFile() && fs.statSync(full).size < 1_200_000) files.push(full);
  } catch {
    // 缺文件就跳过
  }
}

export function interfaceLines(dir) {
  const files = [];
  for (const rel of ["lib/i18n", "packages/i18n/src"]) {
    const abs = path.join(dir, rel);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs)) addInterfaceFile(files, path.join(abs, name));
  }
  const skip = new Set(["node_modules", "dist", ".git", "target", "build", "coverage", ".next", "vendor"]);
  const enter = new Set(["src", "platform", "frontend", "locales", "langs", "lib", "packages", "app", "i18n", "modules"]);
  const walk = (abs, depth) => {
    if (depth > 7 || files.length >= 80) return;
    let entries = [];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const full = path.join(abs, entry.name);
      if (entry.isDirectory()) {
        if (depth === 0 || enter.has(entry.name)) walk(full, depth + 1);
      } else if (/zh-cn\.ts$|zh_CN\.ts$|page-titles\.ts$|siteChrome\.ts$|navigation\.ts$/i.test(entry.name)) addInterfaceFile(files, full);
    }
  };
  walk(dir, 0);
  const localeText = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");
  const headings = [];
  const seenHeads = new Set();
  const walkViews = (abs, depth) => {
    if (depth > 6 || seenHeads.size >= 400) return;
    let entries = [];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skip.has(entry.name) || entry.name === "test" || entry.name === "tests") continue;
      const full = path.join(abs, entry.name);
      if (entry.isDirectory()) walkViews(full, depth + 1);
      else if (/\.(tsx|vue|ts)$/.test(entry.name) && !/\.test\./.test(entry.name) && !seenHeads.has(full)) {
        seenHeads.add(full);
        try {
          const text = fs.readFileSync(full, "utf8");
          if (text.length < 800_000) {
            if (/\.(tsx|vue|ts)$/.test(entry.name)) headings.push(headingLabels(text));
            if (/ui-dict|ui-web|ui-gaps/.test(entry.name)) headings.push(screenLines(text));
            if (/\.(tsx|vue)$/.test(entry.name) || /types|state-machine|labels|status/i.test(entry.name)) headings.push(phraseLabels(text));
          }
        } catch {
          // 读不到的页面不参与入口名称
        }
      }
    }
  };
  walkViews(dir, 0);
  for (const rel of ["scripts/ask-runner.mjs", "scripts/wake-agent.mjs"]) {
    try {
      const abs = path.join(dir, rel);
      if (fs.existsSync(abs)) headings.push(phraseLabels(fs.readFileSync(abs, "utf8")));
    } catch {
      // 读不到的脚本不参与入口名称
    }
  }
  return [screenLines(localeText), phraseLabels(localeText), ...headings].filter(Boolean).join("\n");
}

function manualRank(rel) {
  const lower = rel.toLowerCase();
  if (lower.includes("admin-user-manual") || lower.includes("用户手册")) return 3;
  if (lower.includes("manual") || lower.includes("手册") || lower.includes("help")) return 2;
  if (lower.includes("guide")) return 1;
  return 0;
}

function manualExcerpts(dir, hits) {
  const paths = [];
  for (const hit of hits || []) {
    const rel = String(hit?.path || "").replace(/\\/g, "/").trim();
    if (!rel.endsWith(".md") || rel.includes("..") || path.isAbsolute(rel) || paths.includes(rel)) continue;
    paths.push(rel);
  }
  paths.sort((left, right) => manualRank(right) - manualRank(left));
  paths.splice(3);
  const chunks = [];
  for (const rel of paths) {
    try {
      const lines = fs.readFileSync(path.join(dir, rel), "utf8").split("\n");
      const kept = [];
      for (let index = 0; index < lines.length && index < 2500; index += 1) {
        const line = lines[index];
        if (
          /（\s*`?\/[a-z]/i.test(line) ||
          /^\|\s*`?\/[a-z]/i.test(line) ||
          /^\|\s*[\u4e00-\u9fff]{2,12}\s*\|/.test(line)
        ) {
          kept.push(line.slice(0, 300));
        }
      }
      chunks.push(kept.join("\n"));
    } catch {
      // 测试里的命中文件不必真的在磁盘上
    }
  }
  return chunks.join("\n");
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

function ignoreAskInbox(dir) {
  const exclude = path.join(dir, ".git", "info", "exclude");
  fs.mkdirSync(path.dirname(exclude), { recursive: true });
  const current = fs.existsSync(exclude) ? fs.readFileSync(exclude, "utf8") : "";
  if (!current.includes(".ask-inbox/")) fs.appendFileSync(exclude, "\n.ask-inbox/\n");
}

export async function placeAskImages(dir, images, fetchImpl, origin) {
  const allowed = String(origin || "").replace(/\/$/, "");
  const inbox = path.join(dir, ".ask-inbox");
  fs.mkdirSync(dir, { recursive: true });
  ignoreAskInbox(dir);
  fs.rmSync(inbox, { recursive: true, force: true });
  fs.mkdirSync(inbox, { recursive: true });
  const saved = [];
  for (const image of images || []) {
    const url = String(image?.url || "");
    if (!allowed || !url.startsWith(`${allowed}/api/ask-images/`)) continue;
    let response;
    try {
      response = await fetchImpl(url);
    } catch {
      continue;
    }
    if (!response?.ok || typeof response.arrayBuffer !== "function") continue;
    const name = path.basename(String(image.name || "image.png")).replace(/[^\w.-]+/g, "_").slice(0, 80);
    if (!name || name.startsWith(".")) continue;
    fs.writeFileSync(path.join(inbox, name), Buffer.from(await response.arrayBuffer()));
    saved.push(`.ask-inbox/${name}`);
  }
  return saved;
}

function readAgent(child, onLine, timeoutMs = 4 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    let buf = "";
    let stderr = "";
    let aborted = false;
    const timer = setTimeout(() => {
      aborted = true;
      child.kill("SIGTERM");
    }, timeoutMs);
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
  const secret = config.callbackSecret || config.secrets?.[0];
  if (!secret) throw new Error("没有签名密钥");
  const body = JSON.stringify({ runId: payload.runId, ...event });
  const result = await post(payload.callbackUrl, body, sign(secret, body));
  if (result && Number(result.status) >= 400) {
    const message = result.json?.error || `回调失败 HTTP ${result.status}`;
    throw new Error(String(message).slice(0, 300));
  }
  return result;
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
      if (!res.ok) {
        const message = typeof json.error === "string" ? json.error : `回调失败 HTTP ${res.status}`;
        throw new Error(message);
      }
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
    let synced;
    try {
      synced = syncAskMirror(
        {
          dir,
          askRoot,
          githubUrl: payload.project?.githubUrl || "",
          defaultBranch: payload.project?.defaultBranch || "",
        },
        git
      );
    } catch (error) {
      const head = git(dir, ["rev-parse", "HEAD"]);
      const sha = String(head?.stdout || "").trim();
      if (!/^[0-9a-f]{7,64}$/i.test(sha)) throw error;
      synced = { sha, branch: String(payload.project?.defaultBranch || "") };
    }
    if (mirrorHasMcp(dir)) throw new Error("问答目录里有 MCP 配置，已拒绝启动");
    const probe = await send({ kind: "probe", mirrorSha: synced.sha, text: "" });
    if (probe?.json?.skip) return { skipped: true, sha: synced.sha };
    let prompt = String(payload.prompt || "");
    if (!prompt.trim()) throw new Error("缺少问题");
    const question = questionFromPrompt(prompt);
    const hits = collectAskHits(dir, askSearchTerms(question), git);
    const tableAnswer = draftAskAnswer({
      question,
      documents: documentsFromPrompt(prompt),
      featureMap: featureMapFromPrompt(prompt),
      hits,
      excerpts: [interfaceLines(dir), manualExcerpts(dir, hits)].filter(Boolean).join("\n"),
    });
    const images = Array.isArray(payload.images) ? payload.images : [];
    const mode = isFeatureMapPrompt(prompt)
      ? "map"
      : chooseAskPath({ question, imageCount: images.length, tableAnswer });
    if (mode === "table") {
      console.log(`问答 ${code} #${payload.runId} 快查`);
      await send({ kind: "status", text: "正在查应用里的入口", mirrorSha: synced.sha });
      await send({ kind: "delta", text: tableAnswer, mirrorSha: synced.sha });
      await send({ kind: "done", text: tableAnswer, sessionId: "", mirrorSha: synced.sha });
      return { sha: synced.sha, fast: true };
    }
    if (mode === "deep") {
      console.log(`问答 ${code} #${payload.runId} 对照镜像`);
      await send({ kind: "status", text: "正在对照项目代码", mirrorSha: synced.sha });
      const saved = await placeAskImages(dir, images, deps.fetch || fetch, config.bugboardUrl || "");
      prompt = appendDeepBrief({
        prompt,
        tableAnswer,
        imagePaths: saved,
        imagesOmitted: Boolean(payload.imagesOmitted) || saved.length < images.length,
      });
    } else {
      console.log(`问答 ${code} #${payload.runId} 功能地图`);
      await send({ kind: "status", text: "正在启动回答", mirrorSha: synced.sha });
    }
    const args = buildAskArgv({ cwd: dir, prompt, sessionId: payload.sessionId || "" });
    let answer = "";
    let sessionId = "";
    let wrote = false;
    let pending = "";
    let streamed = false;
    let flushTimer = null;
    const flush = async () => {
      if (!pending) return;
      const text = pending;
      pending = "";
      await send({ kind: "delta", text, mirrorSha: synced.sha });
    };
    const schedule = () => {
      if (flushTimer) return;
      const delay = streamed ? 200 : 0;
      streamed = true;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        void flush();
      }, delay);
    };
    const child = launch(args[0], args.slice(1), dir, askEnv(deps.env || process.env));
    const finished = await readAgent(child, (line) => {
      const parsed = parseAskStreamLine(line);
      if (parsed.kind === "write") {
        wrote = true;
        const command = String(parsed.command || "").replace(/\s+/g, " ").slice(0, 120);
        console.log(`问答 ${code} #${payload.runId} 拒绝写入 ${parsed.name || ""} ${command}`.trim());
        return "abort";
      }
      if (parsed.kind === "text") {
        answer += parsed.text;
        pending += parsed.text;
        schedule();
      }
      if (parsed.kind === "status") void send({ kind: "status", text: parsed.text, mirrorSha: synced.sha });
      if (parsed.sessionId) sessionId = parsed.sessionId;
      if (parsed.kind === "result" && parsed.text) answer = parsed.text;
      return "";
    }, deps.agentTimeoutMs || (mode === "deep" ? 90_000 : 4 * 60 * 1000));
    if (flushTimer) clearTimeout(flushTimer);
    await flush();
    if (wrote) {
      runSteps(
        askGitSteps({ action: "reset", branch: synced.branch }, dir, askRoot).filter((step) => step.args[0] !== "fetch"),
        git
      );
      await send({ kind: "reverted", text: "这次没有回答。代码没有被改动。", mirrorSha: synced.sha });
      return { reverted: true };
    }
    if (finished.aborted && mode === "deep") {
      const after = inspectAskMirror(dir, git);
      const head = git(dir, ["rev-parse", "HEAD"]);
      const sha = String(head?.stdout || "").trim();
      if (after.dirty || (sha && sha !== synced.sha)) {
        runSteps(
          askGitSteps({ action: "reset", branch: synced.branch }, dir, askRoot).filter((step) => step.args[0] !== "fetch"),
          git
        );
      }
      const text = withFilingAdvice(question, fallbackAskAnswer(tableAnswer));
      await send({ kind: "delta", text, mirrorSha: synced.sha });
      await send({ kind: "done", text, sessionId: "", mirrorSha: synced.sha });
      return { sha: synced.sha, fallback: true };
    }
    if (finished.aborted) {
      await send({ kind: "failed", text: "回答超时", mirrorSha: synced.sha });
      return { reverted: false };
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
    answer = withFilingAdvice(question, answer);
    await send({ kind: "done", text: answer, sessionId, mirrorSha: synced.sha });
    return { sha: synced.sha, sessionId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "没有得到回答";
    await send({ kind: "failed", text: message.slice(0, 300) }).catch(() => {});
    return { error: message };
  }
}
