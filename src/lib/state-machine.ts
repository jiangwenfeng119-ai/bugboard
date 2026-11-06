import { isAdminRole } from "./roles";
import type { ActorType, BugStatus, Identity } from "./types";

export { isAdminRole };

export type TransitionAction =
  | "start_fix"
  | "mark_invalid"
  | "request_info"
  | "provide_info"
  | "submit_fix"
  | "confirm_fix"
  | "reject_fix"
  | "dispute_invalid"
  | "reopen_invalid"
  | "withdraw_fix";

export type TransitionSpec = {
  from: BugStatus[];
  to: BugStatus;
  action: TransitionAction;
  who: "admin" | "reporter";
  noteRequired: boolean;
};

export const TRANSITIONS: TransitionSpec[] = [
  {
    from: ["pending"],
    to: "fixing",
    action: "start_fix",
    who: "admin",
    noteRequired: false,
  },
  {
    from: ["pending", "fixing"],
    to: "invalid",
    action: "mark_invalid",
    who: "admin",
    noteRequired: true,
  },
  {
    from: ["pending", "fixing"],
    to: "needs_info",
    action: "request_info",
    who: "admin",
    noteRequired: true,
  },
  {
    from: ["needs_info"],
    to: "pending",
    action: "provide_info",
    who: "reporter",
    noteRequired: true,
  },
  {
    from: ["fixing"],
    to: "awaiting_confirm",
    action: "submit_fix",
    who: "admin",
    noteRequired: true,
  },
  {
    from: ["awaiting_confirm"],
    to: "confirmed",
    action: "confirm_fix",
    who: "reporter",
    noteRequired: false,
  },
  {
    from: ["awaiting_confirm"],
    to: "pending",
    action: "reject_fix",
    who: "reporter",
    noteRequired: true,
  },
  {
    from: ["invalid"],
    to: "pending",
    action: "dispute_invalid",
    who: "reporter",
    noteRequired: true,
  },
  {
    from: ["invalid"],
    to: "pending",
    action: "reopen_invalid",
    who: "admin",
    noteRequired: true,
  },
  {
    from: ["awaiting_confirm"],
    to: "fixing",
    action: "withdraw_fix",
    who: "admin",
    noteRequired: true,
  },
];

export function findTransition(action: TransitionAction, from: BugStatus) {
  return TRANSITIONS.find((t) => t.action === action && t.from.includes(from));
}

export function isReporter(
  identity: Identity,
  reporterType: ActorType,
  reporterId: number
) {
  if (identity.kind === "user") {
    return reporterType === "user" && reporterId === identity.userId;
  }
  return reporterType === "api_key" && reporterId === identity.apiKeyId;
}

export function allowedActions(
  identity: Identity,
  status: BugStatus,
  reporterType: ActorType,
  reporterId: number
): TransitionAction[] {
  const admin = isAdminRole(identity.role);
  const reporter = isReporter(identity, reporterType, reporterId);
  return TRANSITIONS.filter((t) => {
    if (!t.from.includes(status)) return false;
    if (t.who === "admin") return admin;
    return reporter;
  }).map((t) => t.action);
}

export function validateTransition(params: {
  action: TransitionAction;
  from: BugStatus;
  identity: Identity;
  reporterType: ActorType;
  reporterId: number;
  note?: string | null;
}): { ok: true; to: BugStatus } | { ok: false; error: string } {
  const spec = findTransition(params.action, params.from);
  if (!spec) {
    return { ok: false, error: "当前状态不允许该操作" };
  }
  if (spec.who === "admin" && !isAdminRole(params.identity.role)) {
    return { ok: false, error: "需要管理员权限" };
  }
  if (
    spec.who === "reporter" &&
    !isReporter(params.identity, params.reporterType, params.reporterId)
  ) {
    return { ok: false, error: "仅原报障人可执行此操作" };
  }
  if (spec.noteRequired && !params.note?.trim()) {
    return { ok: false, error: "请填写说明" };
  }
  return { ok: true, to: spec.to };
}

export const ACTION_LABEL: Record<TransitionAction, string> = {
  start_fix: "接单（开始修复）",
  mark_invalid: "标为不属实",
  request_info: "要求补充",
  provide_info: "补充材料",
  submit_fix: "提交修复说明",
  confirm_fix: "确认已修复",
  reject_fix: "仍有问题",
  dispute_invalid: "提出异议",
  reopen_invalid: "撤回不属实",
  withdraw_fix: "撤回修复提交",
};
