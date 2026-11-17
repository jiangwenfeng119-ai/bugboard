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

export function nextStepIdleCopy(status: BugStatus) {
  if (status === "confirmed" || status === "acknowledged") {
    return "这张单已经结束。可以看时间线，没有下一步。";
  }
  return "这一步暂时轮不到你。可以先看时间线；轮到你时，这里会出现按钮。";
}
