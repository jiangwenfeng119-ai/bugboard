import type { TransitionAction } from "@/lib/state-machine";
import type { BugStatus } from "@/lib/types";

/** Progress first, then secondary, then destructive — so「下一步」reads as one primary path. */
const ACTION_ORDER: TransitionAction[] = [
  "start_fix",
  "accept_product",
  "provide_info",
  "submit_fix",
  "confirm_fix",
  "reopen_invalid",
  "dispute_invalid",
  "request_product",
  "request_info",
  "withdraw_fix",
  "release_return",
  "accept_invalid",
  "mark_invalid",
  "decline_product",
  "reject_fix",
  "release_fixes",
];

const DANGER_ACTIONS = new Set<TransitionAction>([
  "mark_invalid",
  "decline_product",
  "reject_fix",
]);

function rank(action: TransitionAction) {
  const index = ACTION_ORDER.indexOf(action);
  return index === -1 ? ACTION_ORDER.length : index;
}

/** Buttons on the bug page. Release stays on the changes tab and the release runner. */
export function bugPageActions(actions: TransitionAction[]) {
  return actions
    .filter((action) => action !== "release_fixes")
    .slice()
    .sort((a, b) => rank(a) - rank(b));
}

export function isDangerBugAction(action: TransitionAction) {
  return DANGER_ACTIONS.has(action);
}

/** First non-destructive action earns the solid primary button. */
export function primaryBugAction(actions: TransitionAction[]) {
  return actions.find((action) => !DANGER_ACTIONS.has(action)) ?? null;
}

type NextStepAction = TransitionAction | "add_supplement";

/**
 * One solid primary at rest; danger stays quiet until selected.
 * Selected action becomes the only solid fill so humans see what is open.
 */
export function nextStepButtonClass(
  action: NextStepAction,
  opts: { active: NextStepAction | null; primary: TransitionAction | null }
) {
  const selected = opts.active === action;
  if (action !== "add_supplement" && DANGER_ACTIONS.has(action)) {
    return selected ? "bb-btn bb-btn-danger is-selected" : "bb-btn bb-btn-danger-quiet";
  }
  if (selected) return "bb-btn is-selected";
  if (action !== "add_supplement" && action === opts.primary && !opts.active) {
    return "bb-btn";
  }
  return "bb-btn bb-btn-secondary";
}

export function supplementNoteHint(status: BugStatus) {
  if (status === "needs_product") {
    return "写给产品经理：把这张单想要的能力、背景和遗漏说清楚。状态仍是待产品经理确认。写已经确认也不算点过「可以做」或「不做」。";
  }
  return "写给处理人和 Agent：补清背景、期望或遗漏的细节。不改变状态，会出现在时间线里。";
}

export function productWaitCopy(name: string) {
  const who = name.trim() || "产品经理";
  return `等 ${who} 点可以做或不做`;
}

const STOCK_RETEST_NOTES = new Set(["发布后待确认", "提交修复说明"]);

function meaningfulNote(note?: string | null) {
  const text = note?.trim() ?? "";
  if (!text || STOCK_RETEST_NOTES.has(text)) return "";
  return text;
}

export function retestNoteFromEvents(
  events: { to_status: string; note?: string | null }[]
) {
  const awaiting = [...events]
    .reverse()
    .find((event) => event.to_status === "awaiting_confirm" && meaningfulNote(event.note));
  if (awaiting) return meaningfulNote(awaiting.note);
  const submitted = [...events]
    .reverse()
    .find((event) => event.to_status === "ready_to_release" && meaningfulNote(event.note));
  return submitted ? meaningfulNote(submitted.note) : "";
}

export function nextStepIdleCopy(status: BugStatus) {
  if (status === "confirmed" || status === "acknowledged") {
    return "这张单已经结束。可以看时间线，没有下一步。";
  }
  return "这一步暂时轮不到你。可以先看时间线；轮到你时，这里会出现按钮。";
}
