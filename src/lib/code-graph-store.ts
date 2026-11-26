import { createHmac } from "crypto";
import fs from "fs";
import path from "path";
import { reportExcerpt } from "./code-graph-text";
import { getDb, nowIso } from "./db";
import { canAccessProject, requireAdmin } from "./permissions";
import { getProject } from "./services";
import type { Identity } from "./types";
import { absoluteAttachmentPath } from "./uploads";

const REPORT_MAX = 200_000;
const HTML_MAX = 4_000_000;

export type CodeGraphView = {
  body: string;
  sha: string;
  mirrorSha: string;
  nodes: number;
  edges: number;
  hasHtml: boolean;
  updatedAt: string;
};

function sign(secret: string, body: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function codeGraphExcerpt(projectId: number) {
  const row = getDb()
    .prepare("SELECT body, mirror_sha FROM ask_graphs WHERE project_id = ?")
    .get(projectId) as { body: string; mirror_sha: string } | undefined;
  if (!row?.body.trim()) return "";
  const excerpt = reportExcerpt(row.body, 1500);
  const sha = String(row.mirror_sha || "").trim().slice(0, 8);
  return sha ? `${excerpt}\n基于提交 ${sha}` : excerpt;
}

export function readCodeGraph(identity: Identity, projectId: number): CodeGraphView | null {
  if (!canAccessProject(identity, projectId)) throw new Error("无权访问该项目");
  const row = getDb()
    .prepare(
      `SELECT body, mirror_sha, html_path, node_count, edge_count, updated_at
       FROM ask_graphs WHERE project_id = ?`
    )
    .get(projectId) as
    | {
        body: string;
        mirror_sha: string;
        html_path: string;
        node_count: number;
        edge_count: number;
        updated_at: string;
      }
    | undefined;
  if (!row?.body.trim()) return null;
  const mirror = getDb()
    .prepare("SELECT head_sha FROM ask_mirrors WHERE project_id = ?")
    .get(projectId) as { head_sha: string } | undefined;
  return {
    body: row.body,
    sha: row.mirror_sha,
    mirrorSha: mirror?.head_sha || "",
    nodes: row.node_count,
    edges: row.edge_count,
    hasHtml: Boolean(row.html_path),
    updatedAt: row.updated_at,
  };
}

export function readCodeGraphHtml(identity: Identity, projectId: number) {
  if (!canAccessProject(identity, projectId)) throw new Error("无权访问该项目");
  const row = getDb()
    .prepare("SELECT html_path FROM ask_graphs WHERE project_id = ?")
    .get(projectId) as { html_path: string } | undefined;
  if (!row?.html_path) return null;
  const abs = absoluteAttachmentPath(row.html_path);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs);
}

export function saveCodeGraph(
  identity: Identity,
  projectId: number,
  input: { sha?: string; report?: string; nodes?: number; edges?: number; html?: string }
) {
  if (!requireAdmin(identity)) throw new Error("需要管理员权限");
  if (!canAccessProject(identity, projectId)) throw new Error("无权访问该项目");
  getProject(identity, projectId);
  const sha = String(input.sha || "").trim();
  if (!/^[0-9a-f]{7,64}$/i.test(sha)) throw new Error("提交号无效");
  const report = String(input.report || "").trim();
  if (!report) throw new Error("图谱报告是空的");
  if (report.length > REPORT_MAX) throw new Error("图谱报告过长");
  const nodes = Number(input.nodes) || 0;
  const edges = Number(input.edges) || 0;
  if (!Number.isInteger(nodes) || nodes < 0 || !Number.isInteger(edges) || edges < 0) {
    throw new Error("图谱规模无效");
  }
  const rel = path.join("code-graphs", String(projectId), "graph.html");
  let htmlPath = "";
  if (typeof input.html === "string" && input.html.trim()) {
    const buf = Buffer.from(input.html, "base64");
    if (buf.length > HTML_MAX) throw new Error("交互图谱过大");
    if (buf.length > 0) {
      const abs = absoluteAttachmentPath(rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, buf);
      htmlPath = rel;
    }
  }
  const existing = getDb()
    .prepare("SELECT html_path FROM ask_graphs WHERE project_id = ?")
    .get(projectId) as { html_path: string } | undefined;
  const keptHtml = htmlPath || existing?.html_path || "";
  const updatedAt = nowIso();
  getDb()
    .prepare(
      `INSERT INTO ask_graphs (project_id, body, mirror_sha, html_path, node_count, edge_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         body = excluded.body,
         mirror_sha = excluded.mirror_sha,
         html_path = excluded.html_path,
         node_count = excluded.node_count,
         edge_count = excluded.edge_count,
         updated_at = excluded.updated_at`
    )
    .run(projectId, report, sha, keptHtml, nodes, edges, updatedAt);
  return readCodeGraph(identity, projectId);
}

export async function requestCodeGraph(identity: Identity, projectId: number) {
  if (!canAccessProject(identity, projectId)) throw new Error("无权访问该项目");
  const project = getProject(identity, projectId);
  if (!project.github_url.trim()) throw new Error("这个项目还没有代码仓");
  const dispatch = getDb()
    .prepare("SELECT webhook_url, webhook_secret FROM project_dispatch WHERE project_id = ?")
    .get(projectId) as { webhook_url: string; webhook_secret: string } | undefined;
  if (!dispatch?.webhook_url || !dispatch.webhook_secret) throw new Error("代码机暂时不在");
  const body = JSON.stringify({
    event: "project.graph",
    project: {
      id: project.id,
      code: project.code,
      name: project.name,
      githubUrl: project.github_url,
      defaultBranch: project.default_branch,
    },
  });
  const res = await fetch(dispatch.webhook_url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bugboard-Signature": `sha256=${sign(dispatch.webhook_secret, body)}`,
    },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error("代码机没有接住图谱更新");
  return { ok: true };
}
