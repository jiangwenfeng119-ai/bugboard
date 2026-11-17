import {
  behaviorDefaults,
  WAKE_ACTIONS,
  type BehaviorSettings,
  type WakeAction,
  type WakeSource,
} from "./behavior-shared";
import { getDb, nowIso } from "./db";
import { canAccessProject, requireAdmin } from "./permissions";
import type { Identity, Priority } from "./types";

export {
  behaviorDefaults,
  describeBehavior,
  WAKE_ACTION_LABELS,
  WAKE_ACTIONS,
  type BehaviorSettings,
  type WakeAction,
  type WakeSource,
} from "./behavior-shared";

type BehaviorRow = {
  project_id: number;
  wake_on_web_create?: number | null;
  wake_on_widget_create?: number | null;
  wake_on_capture_create?: number | null;
  wake_on_api_create?: number | null;
  wake_actions?: string | null;
  wake_drain_queue?: number | null;
  intake_priority?: string | null;
  inbox_show_pending?: number | null;
  inbox_show_needs_product?: number | null;
  inbox_show_ready?: number | null;
  inbox_show_own_fixing?: number | null;
  inbox_pending_cap?: number | null;
  release_advances_bugs?: number | null;
  release_timeout_min?: number | null;
  capture_gap_ms?: number | null;
  capture_short_chars?: number | null;
  organize_timeout_min?: number | null;
  ask_enabled?: number | null;
  ask_per_hour?: number | null;
};

function bit(value: number | null | undefined, fallback: boolean) {
  if (value === undefined || value === null) return fallback;
  return value !== 0;
}

function whole(value: number | null | undefined, fallback: number) {
  if (value === undefined || value === null || !Number.isInteger(value)) return fallback;
  return value;
}

function priorityOf(value: string | null | undefined): Priority {
  return value === "p1" || value === "p2" || value === "p3" ? value : "p2";
}

export function parseWakeActions(raw: string | null | undefined): WakeAction[] {
  if (raw == null) return [...WAKE_ACTIONS];
  const wanted = new Set(
    raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
  return WAKE_ACTIONS.filter((action) => wanted.has(action));
}

function fromRow(row: BehaviorRow): BehaviorSettings {
  const defaults = behaviorDefaults();
  return {
    wakeOnWebCreate: bit(row.wake_on_web_create, defaults.wakeOnWebCreate),
    wakeOnWidgetCreate: bit(row.wake_on_widget_create, defaults.wakeOnWidgetCreate),
    wakeOnCaptureCreate: bit(row.wake_on_capture_create, defaults.wakeOnCaptureCreate),
    wakeOnApiCreate: bit(row.wake_on_api_create, defaults.wakeOnApiCreate),
    wakeActions: parseWakeActions(row.wake_actions),
    wakeDrainQueue: bit(row.wake_drain_queue, defaults.wakeDrainQueue),
    intakePriority: priorityOf(row.intake_priority),
    inboxShowPending: bit(row.inbox_show_pending, defaults.inboxShowPending),
    inboxShowNeedsProduct: bit(row.inbox_show_needs_product, defaults.inboxShowNeedsProduct),
    inboxShowReady: bit(row.inbox_show_ready, defaults.inboxShowReady),
    inboxShowOwnFixing: bit(row.inbox_show_own_fixing, defaults.inboxShowOwnFixing),
    inboxPendingCap: whole(row.inbox_pending_cap, defaults.inboxPendingCap),
    releaseAdvancesBugs: bit(row.release_advances_bugs, defaults.releaseAdvancesBugs),
    releaseTimeoutMin: whole(row.release_timeout_min, defaults.releaseTimeoutMin),
    captureGapMs: whole(row.capture_gap_ms, defaults.captureGapMs),
    captureShortChars: whole(row.capture_short_chars, defaults.captureShortChars),
    organizeTimeoutMin: whole(row.organize_timeout_min, defaults.organizeTimeoutMin),
    askEnabled: bit(row.ask_enabled, defaults.askEnabled),
    askPerHour: whole(row.ask_per_hour, defaults.askPerHour),
  };
}

export function readBehaviors(projectIds: number[]): Map<number, BehaviorSettings> {
  const map = new Map<number, BehaviorSettings>();
  for (const id of projectIds) map.set(id, behaviorDefaults());
  if (projectIds.length === 0) return map;
  const placeholders = projectIds.map(() => "?").join(",");
  const rows = getDb()
    .prepare(`SELECT * FROM project_dispatch WHERE project_id IN (${placeholders})`)
    .all(...projectIds) as BehaviorRow[];
  for (const row of rows) map.set(row.project_id, fromRow(row));
  return map;
}

export function readBehavior(projectId: number) {
  return readBehaviors([projectId]).get(projectId) ?? behaviorDefaults();
}

export function wakesOnCreate(settings: BehaviorSettings, source: WakeSource) {
  if (source === "web") return settings.wakeOnWebCreate;
  if (source === "widget") return settings.wakeOnWidgetCreate;
  if (source === "capture") return settings.wakeOnCaptureCreate;
  return settings.wakeOnApiCreate;
}

export function wakeSourceFor(identity: Identity, explicit?: WakeSource): WakeSource {
  if (explicit) return explicit;
  return identity.kind === "api_key" ? "api" : "web";
}

export function adminInboxShows(settings: BehaviorSettings, status: string) {
  if (status === "pending") return settings.inboxShowPending;
  if (status === "needs_product") return settings.inboxShowNeedsProduct;
  if (status === "ready_to_release") return settings.inboxShowReady;
  if (status === "fixing") return settings.inboxShowOwnFixing;
  return true;
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("行为配置无效");
  }
  return value as Record<string, unknown>;
}

function assertBool(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new Error(`${label}无效`);
  return value;
}

function assertInt(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label}要在 ${min} 到 ${max} 之间`);
  }
  return value;
}

function assertWakeActions(value: unknown): WakeAction[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("叫醒动作无效");
  }
  const known = new Set<string>(WAKE_ACTIONS);
  if (value.some((item) => !known.has(item))) throw new Error("叫醒动作无效");
  const wanted = new Set(value);
  return WAKE_ACTIONS.filter((action) => wanted.has(action));
}

export function parseBehaviorInput(value: unknown): BehaviorSettings {
  const input = asRecord(value);
  const priority = input.intakePriority;
  if (priority !== "p1" && priority !== "p2" && priority !== "p3") {
    throw new Error("默认优先级无效");
  }
  return {
    wakeOnWebCreate: assertBool(input.wakeOnWebCreate, "网页建单叫醒"),
    wakeOnWidgetCreate: assertBool(input.wakeOnWidgetCreate, "小组件叫醒"),
    wakeOnCaptureCreate: assertBool(input.wakeOnCaptureCreate, "走查叫醒"),
    wakeOnApiCreate: assertBool(input.wakeOnApiCreate, "API Key 叫醒"),
    wakeActions: assertWakeActions(input.wakeActions),
    wakeDrainQueue: assertBool(input.wakeDrainQueue, "扫完待处理"),
    intakePriority: priority,
    inboxShowPending: assertBool(input.inboxShowPending, "收件箱待处理"),
    inboxShowNeedsProduct: assertBool(input.inboxShowNeedsProduct, "收件箱待产品确认"),
    inboxShowReady: assertBool(input.inboxShowReady, "收件箱待发布"),
    inboxShowOwnFixing: assertBool(input.inboxShowOwnFixing, "收件箱修复中"),
    inboxPendingCap: assertInt(input.inboxPendingCap, "待处理条数", 1, 30),
    releaseAdvancesBugs: assertBool(input.releaseAdvancesBugs, "发布后推进"),
    releaseTimeoutMin: assertInt(input.releaseTimeoutMin, "发布超时", 5, 180),
    captureGapMs: assertInt(input.captureGapMs, "走查停顿", 200, 10000),
    captureShortChars: assertInt(input.captureShortChars, "短句字数", 1, 40),
    organizeTimeoutMin: assertInt(input.organizeTimeoutMin, "整理超时", 1, 60),
    askEnabled: assertBool(input.askEnabled, "项目问答"),
    askPerHour: assertInt(input.askPerHour, "每小时提问", 1, 60),
  };
}

function requireBehaviorAdmin(identity: Identity, projectId: number) {
  if (!requireAdmin(identity)) throw new Error("需要管理员权限");
  const project = getDb().prepare("SELECT id FROM projects WHERE id = ?").get(projectId) as
    | { id: number }
    | undefined;
  if (!project) throw new Error("项目不存在");
  if (!canAccessProject(identity, projectId)) throw new Error("无权访问该项目");
}

export function getBehaviorSettings(identity: Identity, projectId: number) {
  requireBehaviorAdmin(identity, projectId);
  return readBehavior(projectId);
}

export function saveBehaviorSettings(identity: Identity, projectId: number, value: unknown) {
  requireBehaviorAdmin(identity, projectId);
  const settings = parseBehaviorInput(value);
  const t = nowIso();
  getDb()
    .prepare(
      `INSERT INTO project_dispatch (
         project_id, updated_at,
         wake_on_web_create, wake_on_widget_create, wake_on_capture_create, wake_on_api_create,
         wake_actions, wake_drain_queue, intake_priority,
         inbox_show_pending, inbox_show_needs_product, inbox_show_ready, inbox_show_own_fixing,
         inbox_pending_cap, release_advances_bugs, release_timeout_min,
         capture_gap_ms, capture_short_chars, organize_timeout_min, ask_enabled, ask_per_hour
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         updated_at = excluded.updated_at,
         wake_on_web_create = excluded.wake_on_web_create,
         wake_on_widget_create = excluded.wake_on_widget_create,
         wake_on_capture_create = excluded.wake_on_capture_create,
         wake_on_api_create = excluded.wake_on_api_create,
         wake_actions = excluded.wake_actions,
         wake_drain_queue = excluded.wake_drain_queue,
         intake_priority = excluded.intake_priority,
         inbox_show_pending = excluded.inbox_show_pending,
         inbox_show_needs_product = excluded.inbox_show_needs_product,
         inbox_show_ready = excluded.inbox_show_ready,
         inbox_show_own_fixing = excluded.inbox_show_own_fixing,
         inbox_pending_cap = excluded.inbox_pending_cap,
         release_advances_bugs = excluded.release_advances_bugs,
         release_timeout_min = excluded.release_timeout_min,
         capture_gap_ms = excluded.capture_gap_ms,
         capture_short_chars = excluded.capture_short_chars,
         organize_timeout_min = excluded.organize_timeout_min,
         ask_enabled = excluded.ask_enabled,
         ask_per_hour = excluded.ask_per_hour`
    )
    .run(
      projectId,
      t,
      settings.wakeOnWebCreate ? 1 : 0,
      settings.wakeOnWidgetCreate ? 1 : 0,
      settings.wakeOnCaptureCreate ? 1 : 0,
      settings.wakeOnApiCreate ? 1 : 0,
      settings.wakeActions.join(","),
      settings.wakeDrainQueue ? 1 : 0,
      settings.intakePriority,
      settings.inboxShowPending ? 1 : 0,
      settings.inboxShowNeedsProduct ? 1 : 0,
      settings.inboxShowReady ? 1 : 0,
      settings.inboxShowOwnFixing ? 1 : 0,
      settings.inboxPendingCap,
      settings.releaseAdvancesBugs ? 1 : 0,
      settings.releaseTimeoutMin,
      settings.captureGapMs,
      settings.captureShortChars,
      settings.organizeTimeoutMin,
      settings.askEnabled ? 1 : 0,
      settings.askPerHour
    );
  return readBehavior(projectId);
}
