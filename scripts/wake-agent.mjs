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
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
    sessionFile: path.resolve(cwd, "wake.sessions.json"),
    runDir: path.resolve(cwd, "wake-runs"),
  };
}

export function sign(secret, body) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function signatureOk(secrets, body, header) {
  const got = Buffer.from(String(header || "").replace(/^sha256=/, ""));
  let matched = false;
  for (const secret of secrets) {
    const expected = Buffer.from(sign(secret, body));
    if (expected.length === got.length && timingSafeEqual(expected, got)) matched = true;
  }
  return matched;
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

const SHELLS = new Set(["sh", "bash", "zsh", "fish", "osascript", "python", "python3", "node", "perl", "ruby"]);

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
        if (!/^bug:[A-Z][A-Z0-9]{1,7}:\d{1,12}$/.test(savedKey)) continue;
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

export function assertWorkdir(cwd) {
  if (!cwd || typeof cwd !== "string" || !cwd.trim()) {
    throw new Error("没有配置该项目的本地目录");
  }
  const abs = path.resolve(cwd);
  let real;
  try {
    if (!fs.statSync(abs).isDirectory()) throw new Error("工作目录不是文件夹");
    real = fs.realpathSync(abs);
  } catch (error) {
    if (error instanceof Error && error.message === "工作目录不是文件夹") throw error;
    throw new Error("工作目录不存在");
  }
  const home = fs.realpathSync(os.homedir());
  const root = path.parse(real).root;
  if (real === home || real === root) {
    throw new Error("工作目录不能是用户主目录或磁盘根目录");
  }
  if (fs.existsSync(path.join(real, "wake.config.json"))) {
    throw new Error("工作目录里有叫醒密钥，请改到专用的项目目录");
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
    if (payload.event !== "bug.needs_agent" && payload.event !== "capture.needs_organize") {
      send(res, 400, { error: "不认识的事件" });
      return;
    }
    const organize = payload.event === "capture.needs_organize";
    const code = String(payload.project?.code || "");
    const configured = config.projects[code] || config.projects[String(payload.project?.id || "")] || config.cwd;
    let cwd;
    try {
      cwd = assertWorkdir(configured);
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
    console.log(
      config.applyEdits
        ? "已允许在项目目录里自动改文件（--force，仍限制在该目录和沙箱里）。"
        : "默认只读分析（--mode plan），不会自动改文件。要改代码，在 wake.config.json 里写 \"applyEdits\": true。"
    );
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
