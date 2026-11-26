import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const KEEP = ["graph.json", "GRAPH_REPORT.md", "graph.html", "manifest.json"];
const LOCK_MS = 20 * 60 * 1000;

export function assertGraphCode(code) {
  if (!/^[A-Z][A-Z0-9]{1,7}$/.test(String(code || ""))) throw new Error("项目缩写无效");
  return String(code);
}

export function graphParent(askRoot, code) {
  return path.join(path.resolve(askRoot), "graphs", assertGraphCode(code));
}

export function graphOutDir(askRoot, code) {
  return path.join(graphParent(askRoot, code), "graphify-out");
}

export function planCodeGraph({ sha, builtSha, hasGraph }) {
  if (!hasGraph || !builtSha) return "extract";
  if (builtSha === sha) return "skip";
  return "update";
}

export function graphifyBuildArgs(mirrorDir, outParent) {
  return [
    ["extract", mirrorDir, "--code-only", "--out", outParent],
    ["cluster-only", outParent, "--no-label"],
  ];
}

export function queryText(question) {
  const raw = String(question || "");
  const terms = [];
  const push = (term) => {
    const value = String(term || "").trim();
    if (value.length < 2 || value.length > 40 || terms.includes(value)) return;
    terms.push(value);
  };
  for (const match of raw.matchAll(/[A-Za-z_][A-Za-z0-9_./-]{1,40}/g)) push(match[0]);
  for (const match of raw.matchAll(/[「“"]([^」”"]{2,20})[」”"]/g)) push(match[1]);
  for (const match of raw.matchAll(/[\u4e00-\u9fff]{2,6}/g)) {
    if (/^(这个|那个|什么|怎么|如何|是否|可以|现在|我们|你们|一个)$/.test(match[0])) continue;
    push(match[0]);
  }
  return terms.slice(0, 8).join(" ");
}

export function codeFilesFromQuery(text) {
  const found = [];
  for (const match of String(text || "").matchAll(/\[src=(.+?) loc=/g)) {
    const file = match[1].trim();
    if (!file || file.includes("..") || file.length > 180 || found.includes(file)) continue;
    found.push(file);
    if (found.length >= 6) break;
  }
  return found;
}

export function graphSize(report) {
  const match = String(report || "").match(/(\d+) nodes · (\d+) edges/);
  if (!match) return null;
  return { nodes: Number(match[1]), edges: Number(match[2]) };
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function readBuiltSha(parent) {
  return readText(path.join(parent, "built-sha")).trim();
}

export function resolveGraphify(env = process.env) {
  if (env.GRAPHIFY_BIN && String(env.GRAPHIFY_BIN).trim()) return String(env.GRAPHIFY_BIN).trim();
  const local = path.join(os.homedir(), ".local/bin/graphify");
  if (fs.existsSync(local)) return local;
  return "graphify";
}

function defaultSpawn(bin, args, timeoutMs) {
  const result = spawnSync(bin, args, {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 12 * 1024 * 1024,
  });
  const timedOut = result.error && result.error.code === "ETIMEDOUT";
  return {
    code: timedOut ? 124 : result.status ?? 1,
    stdout: result.stdout || "",
    stderr: `${result.stderr || ""}${result.error && !timedOut ? result.error.message : ""}`.trim(),
  };
}

function backupOut(out, parent) {
  const dest = path.join(parent, "backup");
  fs.rmSync(dest, { recursive: true, force: true });
  if (!fs.existsSync(out)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const name of KEEP) {
    const from = path.join(out, name);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dest, name));
  }
}

function restoreOut(out, parent) {
  const dest = path.join(parent, "backup");
  if (!fs.existsSync(dest)) return;
  fs.mkdirSync(out, { recursive: true });
  for (const name of KEEP) {
    const from = path.join(dest, name);
    const target = path.join(out, name);
    if (fs.existsSync(from)) fs.copyFileSync(from, target);
  }
}

function acquireLock(parent) {
  const lock = path.join(parent, "refreshing");
  try {
    const age = Date.now() - fs.statSync(lock).mtimeMs;
    if (age < LOCK_MS) return false;
  } catch {
    // 没有锁
  }
  fs.mkdirSync(parent, { recursive: true });
  fs.writeFileSync(lock, String(Date.now()));
  return true;
}

function releaseLock(parent) {
  fs.rmSync(path.join(parent, "refreshing"), { force: true });
}

function snapshot(parent, out) {
  const report = readText(path.join(out, "GRAPH_REPORT.md"));
  const size = graphSize(report);
  return {
    sha: readBuiltSha(parent),
    report,
    graphPath: path.join(out, "graph.json"),
    nodes: size?.nodes || 0,
    edges: size?.edges || 0,
  };
}

export function refreshCodeGraph(input, spawn = defaultSpawn) {
  const code = assertGraphCode(input.code);
  const sha = String(input.sha || "").trim();
  const parent = graphParent(input.askRoot, code);
  const out = path.join(parent, "graphify-out");
  if (!/^[0-9a-f]{7,64}$/i.test(sha)) return { action: "skip", error: "提交号无效", ...snapshot(parent, out) };
  const hasGraph = fs.existsSync(path.join(out, "graph.json"));
  const action = planCodeGraph({ sha, builtSha: readBuiltSha(parent), hasGraph });
  if (action === "skip") return { action, ...snapshot(parent, out), sha };
  if (!acquireLock(parent)) return { action: "busy", ...snapshot(parent, out) };
  const started = Date.now();
  try {
    backupOut(out, parent);
    const bin = resolveGraphify(input.env);
    const steps = graphifyBuildArgs(input.mirrorDir, parent);
    for (const args of steps) {
      const timeout = args[0] === "extract" ? 10 * 60 * 1000 : 2 * 60 * 1000;
      const result = spawn(bin, args, timeout);
      if (!result || result.code !== 0) {
        restoreOut(out, parent);
        const message = String(result?.stderr || result?.stdout || "图谱没有建成").trim().slice(0, 300);
        return { action, error: message, stale: true, ...snapshot(parent, out) };
      }
    }
    const next = snapshot(parent, out);
    const previous = graphSize(readText(path.join(parent, "backup", "GRAPH_REPORT.md")));
    if (previous && next.nodes >= 0 && previous.nodes >= 50 && next.nodes < previous.nodes * 0.7) {
      restoreOut(out, parent);
      return {
        action,
        error: `节点数从 ${previous.nodes} 降到 ${next.nodes}，已保留旧图`,
        stale: true,
        ...snapshot(parent, out),
      };
    }
    if (!next.report.trim() || !fs.existsSync(next.graphPath)) {
      restoreOut(out, parent);
      return { action, error: "图谱没有写出报告", stale: true, ...snapshot(parent, out) };
    }
    fs.writeFileSync(path.join(parent, "built-sha"), sha);
    fs.rmSync(path.join(parent, "backup"), { recursive: true, force: true });
    return { action, ...snapshot(parent, out), sha, ms: Date.now() - started };
  } finally {
    releaseLock(parent);
  }
}

export function queryCodeGraph(input, spawn = defaultSpawn) {
  const graphPath = String(input.graphPath || "");
  if (!graphPath || !fs.existsSync(graphPath)) return { text: "", files: [] };
  const text = queryText(input.question);
  if (!text) return { text: "", files: [] };
  const result = spawn(resolveGraphify(input.env), ["query", text, "--budget", "800", "--graph", graphPath], 20_000);
  if (!result || (result.code !== 0 && result.code !== 3)) return { text: "", files: [] };
  const output = String(result.stdout || "").trim().slice(0, 2500);
  return { text: output, files: codeFilesFromQuery(output) };
}

export async function publishCodeGraph(input, fetchImpl = fetch) {
  const base = String(input.baseUrl || "").replace(/\/$/, "");
  const token = String(input.token || "");
  const projectId = Number(input.projectId);
  if (!base || !token || !Number.isInteger(projectId) || projectId <= 0) return { ok: false, error: "没有发布目标" };
  const body = {
    sha: String(input.sha || ""),
    report: String(input.report || "").slice(0, 200_000),
    nodes: Number(input.nodes) || 0,
    edges: Number(input.edges) || 0,
  };
  const htmlPath = String(input.htmlPath || "");
  if (htmlPath && fs.existsSync(htmlPath)) {
    const size = fs.statSync(htmlPath).size;
    if (size > 0 && size <= 4_000_000) body.html = fs.readFileSync(htmlPath).toString("base64");
  }
  const send = async (payload) => {
    const res = await fetchImpl(`${base}/api/projects/${projectId}/code-graph`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    return { res, json };
  };
  let { res, json } = await send(body);
  if (!res.ok && body.html) {
    delete body.html;
    ({ res, json } = await send(body));
  }
  if (!res.ok) return { ok: false, error: typeof json.error === "string" ? json.error : `HTTP ${res.status}` };
  return { ok: true };
}

function defaultGit(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { code: result.status ?? 1, stdout: result.stdout || "", stderr: result.stderr || "" };
}

export async function refreshProjectGraphs(config, projects, git = defaultGit, options = {}) {
  const askRoot = String(config.askRoot || "");
  const allowed = config.projects && typeof config.projects === "object" ? config.projects : {};
  const results = [];
  for (const project of projects || []) {
    const code = String(project?.code || "");
    if (!/^[A-Z][A-Z0-9]{1,7}$/.test(code) || !allowed[code]) continue;
    const dir = path.join(askRoot, code);
    if (!fs.existsSync(path.join(dir, ".git"))) {
      results.push({ code, error: "没有镜像" });
      continue;
    }
    const head = git(dir, ["rev-parse", "HEAD"]);
    const sha = String(head?.stdout || "").trim();
    const refreshed = refreshCodeGraph({ askRoot, code, mirrorDir: dir, sha }, options.spawn);
    if (refreshed.error) {
      console.error(`代码图谱 ${code}：${refreshed.error}`);
      results.push({ code, error: refreshed.error });
      continue;
    }
    if ((refreshed.action === "skip" || refreshed.action === "busy") && !options.publishOnSkip) {
      results.push({ code, action: refreshed.action, sha: refreshed.sha });
      continue;
    }
    if (refreshed.action === "busy") {
      results.push({ code, action: "busy" });
      continue;
    }
    const published = await publishCodeGraph(
      {
        baseUrl: config.bugboardUrl,
        token: config.releaseKey,
        projectId: project.id,
        sha: refreshed.sha,
        report: refreshed.report,
        nodes: refreshed.nodes,
        edges: refreshed.edges,
        htmlPath: path.join(graphOutDir(askRoot, code), "graph.html"),
      },
      options.fetchImpl
    );
    if (!published.ok) console.error(`代码图谱 ${code} 没有写回：${published.error}`);
    else console.log(`代码图谱 ${code} ${refreshed.action} ${String(refreshed.sha).slice(0, 7)} ${refreshed.nodes} 个节点`);
    results.push({ code, action: refreshed.action, sha: refreshed.sha, published: published.ok });
  }
  return results;
}
