import { describe, expect, it } from "vitest";
import {
  allowedActions,
  validateTransition,
} from "../src/lib/state-machine";
import type { Identity } from "../src/lib/types";

const admin: Identity = {
  kind: "user",
  userId: 1,
  role: "admin",
  username: "admin",
};

const reporter: Identity = {
  kind: "user",
  userId: 2,
  role: "user",
  username: "qa",
};

const other: Identity = {
  kind: "user",
  userId: 3,
  role: "user",
  username: "other",
};

describe("state machine", () => {
  it("treats superadmin as an admin for transitions", () => {
    const superadmin: Identity = { ...admin, role: "superadmin" };
    expect(allowedActions(superadmin, "pending", "user", 2)).toContain(
      "start_fix"
    );
  });

  it("allows admin to start fix from pending", () => {
    const actions = allowedActions(admin, "pending", "user", 2);
    expect(actions).toContain("start_fix");
    expect(actions).toContain("mark_invalid");
  });

  it("only reporter can confirm", () => {
    expect(allowedActions(reporter, "awaiting_confirm", "user", 2)).toContain(
      "confirm_fix"
    );
    expect(allowedActions(other, "awaiting_confirm", "user", 2)).not.toContain(
      "confirm_fix"
    );
    expect(allowedActions(admin, "awaiting_confirm", "user", 2)).not.toContain(
      "confirm_fix"
    );
  });

  it("requires note for mark_invalid", () => {
    const bad = validateTransition({
      action: "mark_invalid",
      from: "pending",
      identity: admin,
      reporterType: "user",
      reporterId: 2,
      note: "",
    });
    expect(bad.ok).toBe(false);

    const good = validateTransition({
      action: "mark_invalid",
      from: "pending",
      identity: admin,
      reporterType: "user",
      reporterId: 2,
      note: "无法复现",
    });
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.to).toBe("invalid");
  });

  it("rejects illegal transition", () => {
    const result = validateTransition({
      action: "submit_fix",
      from: "pending",
      identity: admin,
      reporterType: "user",
      reporterId: 2,
      note: "done",
    });
    expect(result.ok).toBe(false);
  });
});
