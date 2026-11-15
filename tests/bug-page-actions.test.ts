import { describe, expect, it } from "vitest";
import { bugPageActions } from "../src/app/bugs/[id]/bug-page-actions";
import { allowedActions } from "../src/lib/state-machine";
import type { Identity } from "../src/lib/types";

const admin: Identity = {
  kind: "user",
  userId: 1,
  role: "admin",
  username: "admin",
};

describe("bug page actions", () => {
  it("hides release_fixes on the bug page and keeps withdraw_fix", () => {
    const allowed = allowedActions(admin, "ready_to_release", "user", 2);
    expect(allowed).toContain("release_fixes");
    expect(allowed).toContain("withdraw_fix");
    const shown = bugPageActions(allowed);
    expect(shown).not.toContain("release_fixes");
    expect(shown).toContain("withdraw_fix");
    expect(bugPageActions(shown)).toEqual(shown);
  });
});
