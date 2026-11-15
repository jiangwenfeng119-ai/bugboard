import type { TransitionAction } from "@/lib/state-machine";

/** Buttons on the bug page. Release stays on the changes tab and the release runner. */
export function bugPageActions(actions: TransitionAction[]) {
  return actions.filter((action) => action !== "release_fixes");
}
