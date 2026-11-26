#!/usr/bin/env node
/**
 * 本机叫醒入口。Bugboard 在报障进入待处理后 POST 到这里，
 * 校验签名后拉起 Cursor CLI（agent）或 ZCode。
 *
 * 配置：当前目录的 wake.config.json，环境变量可覆盖。
 * 只监听 127.0.0.1，除非配置 allowLan: true。
 *
 * 报障原文由 Bugboard 包在 <question> 里。本机默认 --mode plan，
 * 不带 --force / --yolo。要在项目目录里自动改文件，配置 applyEdits: true。
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callbackAllowed, isFeatureMapPrompt } from "./ask-protocol.mjs";
import { enqueueAsk, executeAsk, gitSync, syncConfiguredMirrors } from "./ask-runner.mjs";
import { refreshProjectGraphs } from "./code-graph.mjs";

export const MAX_BODY_BYTES = 1_000_000;
export const MAX_PROMPT_CHARS = 60_000;

const ZCODE_PRESET = ["zcode", "-p", "{prompt}"];

export function readConfig(env = process.env, cwd = process.cwd()) {
  const file = path.resolve(cwd, "wake.config.json");
  let fromFile = {};
  if (fs.existsSync(file)) {
    fromFile = JSON.parse(fs.readFileSync(file, "utf8"));
  }
  const secrets = [
    ...(Array.isArray(fromFile.secrets) ? fromFile.secrets : []),
    ...(env.WAKE_SECRET ? [env.WAKE_SECRET] : []),
  ].filter((item) => typeof item === "string" && item.trim());
  return {
    listen: env.WAKE_LISTEN || fromFile.listen || "127.0.0.1:3099",
    agent: env.WAKE_AGENT || fromFile.agent || "cursor",
    argv: fromFile.argv || null,
    allowLan: env.WAKE_ALLOW_LAN === "1" || fromFile.allowLan === true,
    applyEdits: env.WAKE_APPLY_EDITS === "1" || fromFile.applyEdits === true,
    secrets,
    cwd: env.WAKE_CWD || fromFile.cwd || "",
    projects: fromFile.projects || {},
    askRoot: env.WAKE_ASK_ROOT || fromFile.askRoot || path.resolve(cwd, "ask-mirrors"),
    bugboardUrl: env.BUGBOARD_URL || fromFile.bugboardUrl || "",
    releaseKey: env.BUGBOARD_RELEASE_KEY || fromFile.releaseKey || "",
    sessionFile: path.resolve(cwd, "wake.sessions.json"),
    runDir: path.resolve(cwd, "wake-runs"),
  };
}

export function sign(secret, body) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function matchedSecret(secrets, body, header) {
  const got = Buffer.from(String(header || "").replace(/^sha256=/, ""));
  let found = "";
  for (const secret of secrets) {
    const expected = Buffer.from(sign(secret, body));
    if (expected.length === got.length && timingSafeEqual(expected, got)) found = secret;
  }
  return found;
}

export function signatureOk(secrets, body, header) {
  return Boolean(matchedSecret(secrets, body, header));
}

export function usableSessionId(value) {
  if (typeof value !== "string") return "";
  const id = value.trim();
  if (!/^[\w.][\w.-]{0,199}$/.test(id)) return "";
  return id;
}

export function sessionKey(projectCode, bugId) {
  return sessionKeyFor("bug.needs_agent", projectCode, bugId);
}

export function sessionKeyFor(event, projectCode, rawId) {
  const code = String(projectCode || "").trim();
  const id = String(rawId || "").trim();
  if (!/^[A-Z][A-Z0-9]{1,7}$/.test(code) || !/^\d{1,12}$/.test(id)) return "";
  const prefix = event === "capture.needs_organize" ? "capture" : "bug";
  return `${prefix}:${code}:${id}`;
}

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

export function assertAgentCommand(command) {
  const value = String(command || "").trim();
  const simple = /^[\w.+@:-]{1,80}$/.test(value);
  const absolute = /^\/(?:usr|opt|homebrew|Users)\/[\w./+-]{1,180}$/.test(value);
  if ((!simple && !absolute) || value.split("/").includes("..")) {
    throw new Error("agent 命令无效");
  }
  const base = value.split("/").pop();
  if (SHELLS.has(base)) throw new Error("不能用这个命令当 agent");
  return value;
}

export function resolveAgents(payloadAgents, fallbackAgent) {
  if (!Array.isArray(payloadAgents)) {
    return [{ kind: fallbackAgent === "zcode" ? "zcode" : "cursor", command: "" }];
  }
  return payloadAgents.map((item) => ({
    kind: item?.kind === "zcode" || item?.kind === "command" ? item.kind : "cursor",
    command: typeof item?.command === "string" ? item.command.trim() : "",
  }));
}

export function planAgentLaunches({ agents, job, applyEdits, vars, sessionId }) {
  const organize = job === "organize";
  return agents.map((item) => {
    if (item.kind === "command") {
      const command = assertAgentCommand(item.command);
      return { command, args: [vars.prompt] };
    }
    const args = buildLaunchArgv({
      agent: item.kind === "zcode" ? "zcode" : "cursor",
      argv: null,
      applyEdits: organize ? false : applyEdits,
      vars,
      sessionId: organize ? "" : sessionId,
    });
    return { command: args[0], args: args.slice(1) };
  });
}

export function readSession(file, key) {
  if (!key) return "";
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) return "";
    return usableSessionId(data[key]);
  } catch {
    return "";
  }
}

export function writeSession(file, key, sessionId) {
  const id = usableSessionId(sessionId);
  if (!key || !id) return;
  const next = Object.create(null);
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (data && typeof data === "object" && !Array.isArray(data)) {
      for (const [savedKey, savedId] of Object.entries(data)) {
        if (!/^(?:bug|capture):[A-Z][A-Z0-9]{1,7}:\d{1,12}$/.test(savedKey)) continue;
        const usable = usableSessionId(savedId);
        if (usable) next[savedKey] = usable;
      }
    }
  } catch {
    // 第一次写入
  }
  next[key] = id;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next));
  fs.renameSync(tmp, file);
}

export function takeSessionId(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  try {
    return usableSessionId(JSON.parse(raw).session_id);
  } catch {
    return "";
  }
}

function workdirMsg(projectCode, withCode, withoutCode) {
  const code = typeof projectCode === "string" ? projectCode.trim() : "";
  return code ? withCode(code) : withoutCode;
}

export function assertWorkdir(cwd, projectCode = "") {
  if (!cwd || typeof cwd !== "string" || !cwd.trim()) {
    throw new Error(
      workdirMsg(
        projectCode,
        (code) => `没有配置项目 ${code} 的本地目录（wake.config.json 的 projects）`,
        "没有配置该项目的本地目录"
      )
    );
  }
  const notDir = workdirMsg(
    projectCode,
    (code) => `项目 ${code} 的工作目录不是文件夹`,
    "工作目录不是文件夹"
  );
  const abs = path.resolve(cwd);
  let real;
  try {
    if (!fs.statSync(abs).isDirectory()) throw new Error(notDir);
    real = fs.realpathSync(abs);
  } catch (error) {
    if (error instanceof Error && error.message === notDir) throw error;
    throw new Error(
      workdirMsg(projectCode, (code) => `项目 ${code} 的工作目录不存在`, "工作目录不存在")
    );
  }
  const home = fs.realpathSync(os.homedir());
  const root = path.parse(real).root;
  if (real === home || real === root) {
    throw new Error(
      workdirMsg(
        projectCode,
        (code) => `项目 ${code} 的工作目录不能是用户主目录或磁盘根目录`,
        "工作目录不能是用户主目录或磁盘根目录"
      )
    );
  }
  if (fs.existsSync(path.join(real, "wake.config.json"))) {
    throw new Error(
      workdirMsg(
        projectCode,
        (code) => `项目 ${code} 的工作目录里有叫醒密钥，请改到专用的项目目录`,
        "工作目录里有叫醒密钥，请改到专用的项目目录"
      )
    );
  }
  return real;
}

function fillArgv(template, vars) {
  return template.map((part) =>
    String(part)
      .replaceAll("{prompt}", vars.prompt)
      .replaceAll("{cwd}", vars.cwd)
      .replaceAll("{bugId}", vars.bugId)
      .replaceAll("{publicId}", vars.publicId)
      .replaceAll("{projectCode}", vars.projectCode)
      .replaceAll("{session}", vars.session)
  );
}

function isAutoApprove(part) {
  return part === "--force" || part === "--yolo" || part === "-f" || part.startsWith("--force=") || part.startsWith("--yolo=");
}

function modeAt(argv, index) {
  const part = argv[index];
  if (part === "--mode") return { value: argv[index + 1] || "", width: 2 };
  if (typeof part === "string" && part.startsWith("--mode=")) {
    return { value: part.slice("--mode=".length), width: 1 };
  }
  return null;
}

export function buildLaunchArgv({ agent, argv, applyEdits, vars, sessionId }) {
  const session = usableSessionId(sessionId);
  const filledVars = { ...vars, session };
  const custom = Array.isArray(argv) && argv.length > 0;
  let args = custom
    ? fillArgv(argv, filledVars)
    : agent === "zcode"
      ? fillArgv(ZCODE_PRESET, filledVars)
      : [
          "agent",
          "-p",
          "--trust",
          "--sandbox",
          "enabled",
          "--output-format",
          "json",
          "--workspace",
          vars.cwd,
        ];

  const cursor = agent !== "zcode" && (args[0] === "agent" || args[0] === "cursor-agent" || !custom);
  if (!cursor) return args;

  if (!applyEdits) {
    const kept = [];
    for (let i = 0; i < args.length; i += 1) {
      if (isAutoApprove(args[i])) continue;
      const mode = modeAt(args, i);
      if (mode) {
        i += mode.width - 1;
        continue;
      }
      kept.push(args[i]);
    }
    args = kept;
    if (!args.includes("--plan")) args.splice(1, 0, "--mode", "plan");
  } else if (!custom && !args.some(isAutoApprove)) {
    args.splice(1, 0, "--force");
  }

  if (session && !args.includes("--resume") && !args.some((part) => part.startsWith("--resume="))) {
    args.splice(1, 0, "--resume", session);
  }
  const hasWorkspace = args.some((part, index) => part === "--workspace" || String(part).startsWith("--workspace=") || (part === "--workspace" && args[index + 1]));
  if (!hasWorkspace) args.splice(1, 0, "--workspace", vars.cwd);
  if (!args.includes(vars.prompt)) args.push(vars.prompt);
  return args;
}

function startAgent(command, args, cwd, logFile, onExit) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const out = fs.createWriteStream(logFile);
    const err = fs.createWriteStream(logFile.replace(/\.json$/, ".err"));
    const child = spawn(command, args, { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout?.pipe(out);
    child.stderr?.pipe(err);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.unref();
      resolve(child.pid);
    }, 400);
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    child.once("error", fail);
    child.once("exit", (code) => {
      const done = () => {
        if (code) fail(new Error(`${command} 退出码 ${code}`));
        else if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(child.pid);
        }
        if (!code) onExit();
      };
      if (out.closed) done();
      else out.once("close", done);
    });
  });
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function rememberLater(logFile, sessionFile, key) {
  return () => {
    try {
      const text = fs.readFileSync(logFile, "utf8").slice(0, 8_000_000);
      const sessionId = takeSessionId(text);
      if (sessionId) writeSession(sessionFile, key, sessionId);
    } catch {
      // 进程没有留下可解析的 JSON
    }
  };
}

export function createWakeServer(config) {
  return createServer(async (req, res) => {
    if (req.method !== "POST" || (req.url || "").split("?")[0] !== "/wake") {
      send(res, 404, { error: "不存在" });
      return;
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        send(res, 413, { error: "请求过大" });
        return;
      }
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    if (!signatureOk(config.secrets, raw, req.headers["x-bugboard-signature"])) {
      send(res, 401, { error: "签名不对" });
      return;
    }
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      send(res, 400, { error: "不是 JSON" });
      return;
    }
    if (payload.event === "dispatch.test") {
      console.log(`测试叫醒 ${payload.project?.code || ""} ${payload.project?.name || ""}`);
      send(res, 200, { ok: true, spawned: false });
      return;
    }
    if (payload.event === "release.queued") {
      try {
        if (typeof config.spawnRelease === "function") config.spawnRelease(payload);
        else spawnReleaseRunner();
      } catch (error) {
        const message = error instanceof Error ? error.message : "没有拉起发布任务";
        send(res, 500, { error: message });
        return;
      }
      send(res, 202, { ok: true, spawned: true });
      return;
    }
    if (payload.event === "project.graph") {
      const code = String(payload.project?.code || "");
      send(res, 202, { ok: true, spawned: true });
      void refreshProjectGraphs(config, [payload.project || { code }], gitSync, { publishOnSkip: true }).catch((error) => {
        console.error(error instanceof Error ? error.message : error);
      });
      return;
    }
    if (payload.event === "project.ask") {
      const callbackUrl = String(payload.callbackUrl || "");
      if (!callbackAllowed(callbackUrl, config.bugboardUrl || "")) {
        send(res, 400, { error: "回调地址无效" });
        return;
      }
      const code = String(payload.project?.code || "project");
      const callbackSecret = matchedSecret(config.secrets, raw, req.headers["x-bugboard-signature"]);
      send(res, 202, { ok: true, spawned: true });
      const run = config.executeAsk || ((cfg, body) => executeAsk(cfg, body));
      const lane = isFeatureMapPrompt(payload.prompt) ? "map" : "user";
      void enqueueAsk(code, () => Promise.resolve(run({ ...config, callbackSecret }, payload)), lane).catch((error) => {
        console.error(error instanceof Error ? error.message : error);
      });
      return;
    }
    if (payload.event === "ask.needs_optimize" || payload.event === "ask.optimize_revert") {
      const callbackUrl = String(payload.callbackUrl || "");
      if (!callbackAllowed(callbackUrl, config.bugboardUrl || "")) {
        send(res, 400, { error: "回调地址无效" });
        return;
      }
      let cwd;
      try {
        cwd = typeof config.optimizeWorkdir === "function" ? config.optimizeWorkdir() : optimizeWorkdir();
      } catch (error) {
        send(res, 500, { error: error instanceof Error ? error.message : "找不到问答规则" });
        return;
      }
      const prompt = String(payload.prompt || "");
      if (payload.event === "ask.needs_optimize" && !prompt.trim()) {
        send(res, 400, { error: "缺少 prompt" });
        return;
      }
      if (prompt.length > MAX_PROMPT_CHARS) {
        send(res, 413, { error: "提示词过长" });
        return;
      }
      const callbackSecret = matchedSecret(config.secrets, raw, req.headers["x-bugboard-signature"]);
      send(res, 202, { ok: true, spawned: true });
      const run = config.executeOptimize || executeOptimize;
      void Promise.resolve(run({ ...config, callbackSecret }, payload, cwd)).catch((error) => {
        console.error(error instanceof Error ? error.message : error);
      });
      return;
    }
    if (payload.event !== "bug.needs_agent" && payload.event !== "capture.needs_organize") {
      send(res, 400, { error: "不认识的事件" });
      return;
    }
    const organize = payload.event === "capture.needs_organize";
    const code = String(payload.project?.code || "");
    const configured = config.projects[code] || config.projects[String(payload.project?.id || "")] || config.cwd;
    let cwd;
    try {
      cwd = assertWorkdir(configured, code);
    } catch (error) {
      const message = error instanceof Error ? error.message : "工作目录无效";
      send(res, 500, { error: message });
      return;
    }
    const prompt = String(payload.prompt || "");
    if (!prompt.trim()) {
      send(res, 400, { error: "缺少 prompt" });
      return;
    }
    if (prompt.length > MAX_PROMPT_CHARS) {
      send(res, 413, { error: "提示词过长" });
      return;
    }
    const bugId = String(payload.bug?.id || "");
    const captureId = String(payload.capture?.id || "");
    const key = sessionKeyFor(payload.event, code, organize ? captureId : bugId);
    const sessionId = organize ? "" : readSession(config.sessionFile, key);
    const vars = {
      prompt,
      cwd,
      bugId,
      publicId: String(payload.bug?.publicId || ""),
      projectCode: code,
    };
    let launches;
    try {
      launches = Array.isArray(payload.agents)
        ? planAgentLaunches({
            agents: resolveAgents(payload.agents, config.agent),
            job: organize ? "organize" : "fix",
            applyEdits: config.applyEdits,
            vars,
            sessionId,
          })
        : organize
          ? planAgentLaunches({
              agents: resolveAgents(undefined, config.agent),
              job: "organize",
              applyEdits: false,
              vars,
              sessionId: "",
            })
          : [
              (() => {
                const args = buildLaunchArgv({
                  agent: config.agent,
                  argv: config.argv,
                  applyEdits: config.applyEdits,
                  vars,
                  sessionId,
                });
                return { command: args[0], args: args.slice(1) };
              })(),
            ];
    } catch (error) {
      const message = error instanceof Error ? error.message : "agent 无效";
      send(res, 400, { error: message });
      return;
    }
    if (!launches.length) {
      send(res, 200, { ok: true, spawned: false });
      return;
    }
    const logStem = `${code || "project"}-${organize ? `cap-${captureId || "na"}` : bugId || "na"}`.replace(
      /[^\w.-]+/g,
      "_"
    );
    let lastError = "拉起失败";
    for (let index = 0; index < launches.length; index += 1) {
      const launch = launches[index];
      const logName = launches.length === 1 ? `${logStem}.json` : `${logStem}-${index + 1}.json`;
      try {
        const pid = await startAgent(
          launch.command,
          launch.args,
          cwd,
          path.join(config.runDir, logName),
          rememberLater(path.join(config.runDir, logName), config.sessionFile, key)
        );
        console.log(`已拉起 ${launch.command} pid=${pid} ${vars.publicId || captureId || vars.bugId} cwd=${cwd}`);
        send(res, 202, { ok: true, spawned: true, pid, agent: launch.command });
        return;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "拉起失败";
        console.error(lastError);
      }
    }
    send(res, 500, { error: lastError });
  });
}

export const OPTIMIZE_PATHS = [
  ".cursor/skills/ask-before-report/SKILL.md",
  "src/lib/ask-core.ts",
  "scripts/ask-protocol.mjs",
];

export function optimizeWorkdir(moduleUrl = import.meta.url) {
  const root = path.resolve(path.dirname(fileURLToPath(moduleUrl)), "..");
  const skill = path.join(root, ".cursor/skills/ask-before-report/SKILL.md");
  const protocol = path.join(root, "scripts/ask-protocol.mjs");
  if (!fs.existsSync(skill) || !fs.existsSync(protocol)) {
    throw new Error("这台代码机上找不到问答规则，不能优化");
  }
  return fs.realpathSync(root);
}

export function interpretOptimizeGit({ id, exitCode, subject, sha, worktreeDiff }) {
  const wanted = `ask-optimize #${id}`;
  const committed = String(subject || "").startsWith(wanted) && /^[0-9a-f]{7,40}$/.test(String(sha || ""));
  const diff = String(worktreeDiff || "").trim().slice(0, 180000);
  if (exitCode && !diff && !committed) {
    return { kind: "failed", diff: "", commitSha: "", revertSha: "", detail: `处理 Agent 退出码 ${exitCode}` };
  }
  if (!diff) {
    return {
      kind: "done",
      diff: "",
      commitSha: committed ? sha : "",
      revertSha: "",
      detail: "处理结束，问答规则这几处没有改动",
    };
  }
  const note = committed ? `已提交 ${String(sha).slice(0, 7)}` : "改动还在工作区，尚未形成这次优化的提交";
  const extra = exitCode ? `。进程退出码 ${exitCode}` : "";
  return { kind: "done", diff, commitSha: committed ? sha : "", revertSha: "", detail: `${note}${extra}` };
}

export function revertGitArgs(commitSha) {
  if (!/^[0-9a-f]{7,40}$/.test(String(commitSha || ""))) return null;
  return ["revert", "--no-edit", String(commitSha)];
}

function gitText(cwd, args, input) {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    input,
    timeout: 20000,
  });
  return { code: result.status ?? 1, text: `${result.stdout || ""}${result.stderr || ""}` };
}

export function readOptimizeOutcome(cwd, id, exitCode) {
  const log = gitText(cwd, ["log", "-1", "--format=%H%n%s"]);
  if (log.code !== 0) {
    return { kind: "failed", diff: "", commitSha: "", revertSha: "", detail: "这台代码机上的问答目录不是 git 仓库" };
  }
  const [sha = "", subject = ""] = log.text.split("\n");
  const wanted = subject.trim().startsWith(`ask-optimize #${id}`);
  const shown = wanted
    ? gitText(cwd, ["show", "--format=", "HEAD", "--", ...OPTIMIZE_PATHS])
    : gitText(cwd, ["diff", "HEAD", "--", ...OPTIMIZE_PATHS]);
  return interpretOptimizeGit({
    id,
    exitCode,
    subject: subject.trim(),
    sha: sha.trim(),
    worktreeDiff: shown.text,
  });
}

function runToExit(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: "ignore" });
    child.once("error", () => resolve(1));
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

async function postOptimize(url, secret, body) {
  const raw = JSON.stringify(body);
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bugboard-Signature": `sha256=${sign(secret, raw)}`,
    },
    body: raw,
  });
}

export async function executeOptimize(config, payload, cwd) {
  const id = Number(payload.optimizationId);
  const secret = config.callbackSecret || "";
  const callbackUrl = String(payload.callbackUrl || "");
  let outcome;
  if (payload.event === "ask.optimize_revert") {
    const sha = String(payload.commitSha || "");
    const args = revertGitArgs(sha);
    if (args) {
      const reverted = gitText(cwd, args);
      if (reverted.code !== 0) {
        outcome = {
          kind: "failed",
          diff: String(payload.diff || ""),
          commitSha: sha,
          revertSha: "",
          detail: reverted.text.trim().slice(0, 300) || "回滚提交失败",
        };
      } else {
        const head = gitText(cwd, ["rev-parse", "HEAD"]);
        outcome = {
          kind: "reverted",
          diff: String(payload.diff || ""),
          commitSha: sha,
          revertSha: head.text.trim(),
          detail: "已撤回这次提交",
        };
      }
    } else if (String(payload.diff || "").trim()) {
      const applied = gitText(cwd, ["apply", "--reverse", "--whitespace=nowarn", "-"], String(payload.diff));
      outcome = applied.code
        ? {
            kind: "failed",
            diff: String(payload.diff),
            commitSha: "",
            revertSha: "",
            detail: applied.text.trim().slice(0, 300) || "补丁无法反向应用",
          }
        : {
            kind: "reverted",
            diff: String(payload.diff),
            commitSha: "",
            revertSha: "",
            detail: "已按记下的差异回滚",
          };
    } else {
      outcome = { kind: "failed", diff: "", commitSha: "", revertSha: "", detail: "没有可回滚的改动" };
    }
  } else {
    const prompt = String(payload.prompt || "");
    const args = buildLaunchArgv({
      agent: config.agent === "zcode" ? "zcode" : "cursor",
      argv: null,
      applyEdits: true,
      vars: { prompt, cwd, bugId: String(id), publicId: "", projectCode: "ASK", session: "" },
      sessionId: "",
    });
    const exitCode = await runToExit(args[0], args.slice(1), cwd);
    outcome = readOptimizeOutcome(cwd, id, exitCode);
  }
  await postOptimize(callbackUrl, secret, { optimizationId: id, ...outcome });
}

export function spawnReleaseRunner() {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "release-runner.mjs");
  if (!fs.existsSync(script)) throw new Error("找不到发布任务脚本");
  const child = spawn(process.execPath, [script], {
    detached: true,
    stdio: "ignore",
    cwd: process.cwd(),
    env: process.env,
  });
  child.unref();
}

function main() {
  const config = readConfig();
  if (config.secrets.length === 0) {
    console.error("wake.config.json 里要有 secrets，或设置 WAKE_SECRET");
    process.exit(1);
  }
  const [host, portText] = config.listen.includes(":")
    ? [config.listen.slice(0, config.listen.lastIndexOf(":")), config.listen.slice(config.listen.lastIndexOf(":") + 1)]
    : ["127.0.0.1", config.listen];
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`端口无效：${config.listen}`);
    process.exit(1);
  }
  const bindHost = host || "127.0.0.1";
  if (bindHost !== "127.0.0.1" && bindHost !== "localhost" && !config.allowLan) {
    console.error("默认只监听 127.0.0.1。要给 Docker 或局域网用，在配置里写 allowLan: true");
    process.exit(1);
  }
  const server = createWakeServer(config);
  server.listen(port, bindHost, () => {
    console.log(`叫醒服务监听 http://${bindHost}:${port}/wake`);
    console.log(`Agent：${config.agent}。项目目录：${Object.keys(config.projects).join(", ") || config.cwd || "（还没配）"}`);
    console.log(`问答镜像目录：${config.askRoot}`);
    setInterval(() => {
      void syncAskProjects(config);
    }, 24 * 60 * 60 * 1000).unref();
    console.log(
      config.applyEdits
        ? "已允许在项目目录里自动改文件（--force，仍限制在该目录和沙箱里）。"
        : "默认只读分析（--mode plan），不会自动改文件。要改代码，在 wake.config.json 里写 \"applyEdits\": true。"
    );
    void syncAskProjects(config);
  });
}

async function syncAskProjects(config) {
  if (!config.bugboardUrl || !config.releaseKey) return;
  try {
    const res = await fetch(`${String(config.bugboardUrl).replace(/\/$/, "")}/api/projects`, {
      headers: { Authorization: `Bearer ${config.releaseKey}` },
    });
    if (!res.ok) {
      console.error(`同步项目清单失败 HTTP ${res.status}`);
      return;
    }
    const data = await res.json();
    const projects = Array.isArray(data.projects)
      ? data.projects.map((item) => ({
          code: item.code,
          githubUrl: item.github_url,
          defaultBranch: item.default_branch,
        }))
      : [];
    const synced = syncConfiguredMirrors(config, projects, gitSync);
    for (const item of synced) {
      if (item.error) console.error(`问答镜像 ${item.code}：${item.error}`);
      else console.log(`问答镜像 ${item.code} ${String(item.sha).slice(0, 7)}`);
    }
    await resumeQueuedAsks(config);
    void refreshProjectGraphs(config, projects, gitSync).catch((error) => {
      console.error(error instanceof Error ? error.message : "更新代码图谱失败");
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "同步问答镜像失败");
  }
}

async function resumeQueuedAsks(config) {
  const res = await fetch(`${String(config.bugboardUrl).replace(/\/$/, "")}/api/ask/pending`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.releaseKey}` },
  });
  if (!res.ok) return;
  const data = await res.json();
  for (const job of Array.isArray(data.jobs) ? data.jobs : []) {
    await executeAsk(config, job);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
