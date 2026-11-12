import type { ProjectProfile } from "./project-profile";

export type Role = "user" | "admin" | "superadmin";
export type ProjectRole = "user" | "admin";
export type ActorType = "user" | "api_key";
export type Priority = "p1" | "p2" | "p3";
export type BugStatus =
  | "pending"
  | "fixing"
  | "needs_info"
  | "needs_product"
  | "awaiting_confirm"
  | "confirmed"
  | "acknowledged"
  | "invalid";

export const STATUS_LABEL: Record<BugStatus, string> = {
  pending: "待处理",
  fixing: "修复中",
  needs_info: "待补充",
  needs_product: "待产品经理确认",
  awaiting_confirm: "待确认",
  confirmed: "已确认",
  acknowledged: "已认可",
  invalid: "不属实",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  p1: "P1 严重 / 阻断",
  p2: "P2 功能异常",
  p3: "P3 体验优化",
};

export const PRIORITY_HINT: Record<Priority, string> = {
  p1: "核心流程不可用、崩溃、错误结果、数据风险",
  p2: "能进入功能但行为不对或不稳定；有变通但仍影响使用",
  p3: "不阻挡使用，偏 UI / 文案 / 交互",
};

export type Identity =
  | { kind: "user"; userId: number; role: Role; username: string }
  | {
      kind: "api_key";
      apiKeyId: number;
      role: Role;
      name: string;
      projectIds: number[];
    };

export type UserRow = {
  id: number;
  username: string;
  password_hash: string;
  role: Role;
  active: number;
  created_at: string;
  updated_at: string;
};

export type ProjectRow = {
  id: number;
  name: string;
  slug: string;
  code: string;
  description: string;
  logo_path: string;
  widget_token: string | null;
  widget_owner_user_id: number | null;
  created_at: string;
  updated_at: string;
} & ProjectProfile;

export type BugRow = {
  id: number;
  project_id: number;
  public_id: string;
  title: string;
  body: string;
  priority: Priority;
  status: BugStatus;
  reporter_type: ActorType;
  reporter_id: number;
  quote: string;
  steps_json: string;
  evidence_sec: number | null;
  strokes_json: string;
  confidence: string;
  open_question: string;
  source_url: string;
  capture_session_id: number | null;
  created_at: string;
  updated_at: string;
};

export type AnalyticsRange = "all" | 7 | 30 | 90;

export type AnalyticsTrendGrain = "day" | "week" | "month";

export type AnalyticsTrendPoint = {
  key: string;
  label: string;
  hint: string;
  count: number;
};

export type AnalyticsTrend = {
  grain: AnalyticsTrendGrain;
  points: AnalyticsTrendPoint[];
};

/** Daily counts aligned to the project trend window, one row per person. */
export type DayCountSeries = {
  key: string;
  label: string;
  counts: number[];
};

export type StatusCounts = Record<BugStatus, number>;

export type ReporterPresence = "active" | "disabled" | "revoked" | "missing";

export type ReporterProjectStat = StatusCounts & {
  projectId: number;
  projectName: string;
  total: number;
  adopted: number;
};

export type ReporterStat = StatusCounts & {
  reporterType: ActorType;
  reporterId: number;
  name: string;
  presence: ReporterPresence;
  total: number;
  adopted: number;
  projects: ReporterProjectStat[];
};

export type ReporterAnalytics = {
  range: AnalyticsRange;
  reporters: ReporterStat[];
  totals: StatusCounts & {
    total: number;
    adopted: number;
    submitters: number;
  };
  trend: AnalyticsTrend;
};

export type StatusEventRow = {
  id: number;
  bug_id: number;
  from_status: BugStatus | null;
  to_status: BugStatus;
  actor_type: ActorType;
  actor_id: number;
  note: string | null;
  created_at: string;
};

export type AttachmentRow = {
  id: number;
  owner_type: "bug" | "status_event";
  owner_id: number;
  filename: string;
  mime: string;
  size: number;
  storage_path: string;
  created_at: string;
};

export type ApiKeyRow = {
  id: number;
  name: string;
  key_hash: string;
  key_prefix: string;
  role: Role;
  created_by_user_id: number;
  last_used_at: string | null;
  use_count: number;
  disabled_at: string | null;
  revoked_at: string | null;
  created_at: string;
};
