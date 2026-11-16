import type { TransitionAction } from "@/lib/state-machine";

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
