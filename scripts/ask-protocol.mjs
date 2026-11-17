const WRITE_NAME = /write|delete|strreplace|applypatch|editnotebook|search_replace|edit_file/i;
const MUTATING_SHELL =
  /\b(rm|mv|tee|chmod|chown|dd|truncate)\b|>>?|[|&;]\s*|git\s+(commit|push|reset|checkout|clean|add|merge|rebase|switch)/i;

export function usableAskSession(value) {
  if (typeof value !== "string") return "";
  const id = value.trim();
  if (!/^[\w.][\w.-]{0,199}$/.test(id)) return "";
  return id;
}

export function assertCloneUrl(url) {
  const value = String(url || "").trim();
  if (/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?$/.test(value)) return value;
  if (/^git@github\.com:[\w.-]+\/[\w.-]+(?:\.git)?$/.test(value)) return value;
  return "";
}

export function assertAskBranch(value) {
  const branch = String(value || "").trim();
  if (!branch) return "";
  if (!/^[\w][\w./-]{0,118}$/.test(branch) || branch.includes("..") || branch.endsWith("/") || branch.endsWith(".")) {
    throw new Error("默认分支无效");
  }
  return branch;
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

export function askOriginsMatch(originUrl, githubUrl) {
  const origin = canonicalRemote(originUrl);
  const github = canonicalRemote(githubUrl);
  return Boolean(origin) && origin === github;
}

export function planAskMirror(input) {
  const url = assertCloneUrl(input.githubUrl);
  let branch = "";
  try {
    branch = assertAskBranch(input.defaultBranch);
  } catch (error) {
    return { action: "refuse", reason: error instanceof Error ? error.message : "默认分支无效" };
  }
  if (!String(input.githubUrl || "").trim()) {
    return { action: "refuse", reason: "这个项目还没有代码仓，请直接写报障" };
  }
  if (!url) return { action: "refuse", reason: "代码仓地址无效" };
  if (!input.exists) return { action: "clone", url, branch };
  if (!input.isGit) return { action: "refuse", reason: "问答目录不是 git 仓库" };
  if (!askOriginsMatch(input.originUrl, url)) {
    return { action: "refuse", reason: "问答目录的 origin 和代码仓不一致" };
  }
  const head = String(input.headBranch || "").trim();
  const target = branch || head;
  if (!target) return { action: "refuse", reason: "项目没有默认分支" };
  if (input.dirty || input.ahead > 0 || (branch && head && head !== branch)) {
    return { action: "reset", branch: target };
  }
  if (input.behind > 0) return { action: "ff", branch: target };
  return { action: "ready", branch: target };
}

export function cloneUrlForMachine(url) {
  return String(url || "").replace(/^https:\/\/github\.com\//, "git@github.com:");
}

export function askGitSteps(plan, dir, askRoot) {
  if (plan.action === "clone") {
    const args = ["clone", "--single-branch"];
    if (plan.branch) args.push("--branch", plan.branch);
    args.push(cloneUrlForMachine(plan.url), dir);
    return [{ cwd: askRoot, args }];
  }
  if (plan.action === "ff") {
    return [
      { cwd: dir, args: ["fetch", "origin"] },
      { cwd: dir, args: ["pull", "--ff-only", "origin", plan.branch] },
    ];
  }
  if (plan.action === "reset") {
    const remote = `origin/${plan.branch}`;
    return [
      { cwd: dir, args: ["fetch", "origin"] },
      { cwd: dir, args: ["checkout", "-B", plan.branch, remote] },
      { cwd: dir, args: ["reset", "--hard", remote] },
      { cwd: dir, args: ["clean", "-fd"] },
    ];
  }
  return [];
}

export function buildAskArgv({ cwd, prompt, sessionId }) {
  const args = [
    "agent",
    "-p",
    "--mode",
    "ask",
    "--sandbox",
    "enabled",
    "--trust",
    "--output-format",
    "stream-json",
    "--stream-partial-output",
    "--workspace",
    cwd,
  ];
  const session = usableAskSession(sessionId);
  if (session) args.splice(2, 0, "--resume", session);
  args.push(prompt);
  return args.filter((part) => part !== "--force" && part !== "--yolo" && part !== "-f" && part !== "--approve-mcps");
}

export function askEnv(base) {
  const env = { ...base };
  for (const key of Object.keys(env)) {
    if (key.startsWith("BUGBOARD_") || key === "WAKE_SECRET") delete env[key];
  }
  return env;
}

export function callbackAllowed(callbackUrl, bugboardUrl) {
  let url;
  try {
    url = new URL(String(callbackUrl || ""));
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.pathname !== "/api/ask/callback") return false;
  if (url.username || url.password) return false;
  const base = String(bugboardUrl || "").trim();
  if (!base) {
    return url.hostname === "127.0.0.1" || url.hostname === "localhost";
  }
  try {
    return url.origin === new URL(base).origin;
  } catch {
    return false;
  }
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

function findTool(data) {
  const call = data.tool_call || data.toolCall;
  if (call && typeof call === "object") {
    if (typeof call.name === "string") {
      return {
        name: call.name,
        path: stringValue(call.args?.path || call.args?.file_path || call.args?.target_file),
        command: stringValue(call.args?.command),
      };
    }
    for (const [key, value] of Object.entries(call)) {
      if (!value || typeof value !== "object") continue;
      const args = value.args && typeof value.args === "object" ? value.args : value;
      return {
        name: key,
        path: stringValue(args.path || args.file_path || args.target_file),
        command: stringValue(args.command),
      };
    }
  }
  if (data.type === "tool_use" || data.type === "tool_call") {
    return {
      name: stringValue(data.name),
      path: stringValue(data.input?.path || data.input?.file_path),
      command: stringValue(data.input?.command),
    };
  }
  return null;
}

function extractText(data) {
  if (typeof data.text === "string" && (data.type === "text" || data.type === "delta" || data.type === "assistant")) {
    return data.text;
  }
  const content = data.message?.content;
  if (Array.isArray(content)) {
    return content
      .filter((item) => item && item.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("");
  }
  if (typeof data.delta === "string") return data.delta;
  if (typeof data.delta?.text === "string") return data.delta.text;
  return "";
}

function statusPath(filePath) {
  const text = String(filePath || "").replace(/\\/g, "/");
  if (!text || text.length > 180 || /(^|\/)\.env|id_rsa|credentials|secret/i.test(text)) return "正在查看代码";
  const relative = text.includes("/src/") ? text.slice(text.indexOf("/src/") + 1) : text.split("/").slice(-3).join("/");
  return `正在查看 ${relative}`.slice(0, 240);
}

export function parseAskStreamLine(line) {
  const raw = String(line || "").trim();
  if (!raw.startsWith("{")) return { kind: "ignore" };
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { kind: "ignore" };
  }
  if (!data || typeof data !== "object") return { kind: "ignore" };
  const sessionId = usableAskSession(data.session_id || data.sessionId || "");
  const tool = findTool(data);
  if (tool) {
    const shell = /shell|bash|command/i.test(tool.name);
    if ((WRITE_NAME.test(tool.name) && !/read/i.test(tool.name)) || (shell && MUTATING_SHELL.test(tool.command))) {
      return { kind: "write", name: tool.name };
    }
    return { kind: "status", text: statusPath(tool.path) };
  }
  if (data.type === "result" || data.type === "done") {
    return { kind: "result", text: typeof data.result === "string" ? data.result : "", sessionId };
  }
  const text = extractText(data);
  if (text) return { kind: "text", text, sessionId };
  if (sessionId) return { kind: "session", sessionId };
  return { kind: "ignore" };
}
