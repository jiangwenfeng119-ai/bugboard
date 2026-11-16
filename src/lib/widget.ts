import { nanoid } from "nanoid";
import { getDb, nowIso } from "./db";
import { readBehavior } from "./behavior";
import { createBug, getProject } from "./services";
import type { Identity, Role } from "./types";
import { stageUpload } from "./staged";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_TOKEN = 60;
const MAX_PER_IP = 30;

export function resetWidgetRateForTests() {
  getDb().prepare("DELETE FROM rate_events WHERE bucket LIKE 'widget:%'").run();
}

function widgetCount(bucket: string, now: number) {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS c FROM rate_events WHERE bucket = ? AND at > ?")
    .get(bucket, now - WINDOW_MS) as { c: number };
  return row.c;
}

export function assertWidgetRate(token: string, ip: string) {
  const now = Date.now();
  const check = getDb().transaction(() => {
    getDb().prepare("DELETE FROM rate_events WHERE bucket LIKE 'widget:%' AND at <= ?").run(now - WINDOW_MS);
    const tokenBucket = `widget:token:${token}`;
    if (widgetCount(tokenBucket, now) >= MAX_PER_TOKEN) {
      throw new Error("提交过于频繁，请稍后再试");
    }
    const ipBucket = ip === "direct" ? "" : `widget:ip:${token}:${ip}`;
    if (ipBucket && widgetCount(ipBucket, now) >= MAX_PER_IP) {
      throw new Error("提交过于频繁，请稍后再试");
    }
    const insert = getDb().prepare("INSERT INTO rate_events (bucket, at) VALUES (?, ?)");
    insert.run(tokenBucket, now);
    if (ipBucket) insert.run(ipBucket, now);
  });
  check.immediate();
}

function requireAdminUser(identity: Identity) {
  if (identity.kind !== "user" || (identity.role !== "admin" && identity.role !== "superadmin")) {
    throw new Error("需要管理员权限");
  }
  return identity;
}

export function ensureWidgetToken(identity: Identity, projectId: number) {
  const admin = requireAdminUser(identity);
  const project = loadProject(identity, projectId);
  if (project.widget_token && project.widget_owner_user_id) {
    return { token: project.widget_token, ownerUserId: project.widget_owner_user_id };
  }
  const token = nanoid(32);
  getDb()
    .prepare(
      "UPDATE projects SET widget_token = ?, widget_owner_user_id = ?, updated_at = ? WHERE id = ?"
    )
    .run(token, admin.userId, nowIso(), projectId);
  return { token, ownerUserId: admin.userId };
}

export function rotateWidgetToken(identity: Identity, projectId: number) {
  const admin = requireAdminUser(identity);
  loadProject(identity, projectId);
  const token = nanoid(32);
  getDb()
    .prepare(
      "UPDATE projects SET widget_token = ?, widget_owner_user_id = ?, updated_at = ? WHERE id = ?"
    )
    .run(token, admin.userId, nowIso(), projectId);
  return { token, ownerUserId: admin.userId };
}

function loadProject(identity: Identity, projectId: number) {
  return getProject(identity, projectId);
}

export function widgetSnippet(origin: string, token: string) {
  const src = `${origin.replace(/\/$/, "")}/widget.js?token=${encodeURIComponent(token)}`;
  return `<script src="${src}" async></script>`;
}

export function createWidgetReport(
  token: string,
  input: {
    ip: string;
    title?: string;
    note?: string;
    pageUrl?: string;
    viewport?: string;
    userAgent?: string;
    consoleText?: string;
    file?: { filename: string; mime: string; buffer: Buffer } | null;
  }
) {
  assertWidgetRate(token, input.ip);
  const project = getDb()
    .prepare(
      "SELECT id, widget_token, widget_owner_user_id FROM projects WHERE widget_token = ?"
    )
    .get(token) as
    | { id: number; widget_token: string | null; widget_owner_user_id: number | null }
    | undefined;
  if (!project?.widget_token || !project.widget_owner_user_id) throw new Error("上报入口无效");
  const owner = getDb()
    .prepare("SELECT id, username, role, active FROM users WHERE id = ?")
    .get(project.widget_owner_user_id) as
    | { id: number; username: string; role: Role; active: number }
    | undefined;
  if (!owner || !owner.active) throw new Error("上报入口已失效");
  if (owner.role !== "admin" && owner.role !== "superadmin") throw new Error("上报入口已失效");

  const note = (input.note || "").trim().slice(0, 4000);
  const pageUrl = (input.pageUrl || "").trim().slice(0, 500);
  if (pageUrl && !/^https?:\/\//i.test(pageUrl)) throw new Error("页面地址无效");
  const viewport = (input.viewport || "").trim().slice(0, 80);
  const userAgent = (input.userAgent || "").trim().slice(0, 300);
  if (!note && !input.file) throw new Error("写一句现象，或附上截图");

  const behavior = readBehavior(project.id);
  const title = (input.title || note || "网页上报").trim().slice(0, 200) || "网页上报";
  const blocks = [note, pageUrl ? `页面：${pageUrl}` : "", viewport ? `视口：${viewport}` : "", userAgent ? `浏览器：${userAgent}` : ""].filter(Boolean);
  const identity: Identity = {
    kind: "user",
    userId: owner.id,
    role: owner.role,
    username: owner.username,
  };
  const attachmentIds = input.file
    ? [
        stageUpload(identity, project.id, {
          filename: input.file.filename,
          buffer: input.file.buffer,
        }).id,
      ]
    : [];
  return createBug(identity, {
    projectId: project.id,
    title,
    body: blocks.join("\n\n"),
    priority: behavior.intakePriority,
    wakeSource: "widget",
    evidence: {
      quote: note,
      sourceUrl: pageUrl,
      attachmentIds,
    },
  });
}
