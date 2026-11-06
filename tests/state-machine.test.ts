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

  it("lets an admin withdraw a wrong invalid mark back to pending", () => {
    expect(allowedActions(admin, "invalid", "user", 2)).toContain(
      "reopen_invalid"
    );
    expect(allowedActions(reporter, "invalid", "user", 2)).not.toContain(
      "reopen_invalid"
    );
    expect(allowedActions(reporter, "invalid", "user", 2)).toContain(
      "dispute_invalid"
    );

    const missing = validateTransition({
      action: "reopen_invalid",
      from: "invalid",
      identity: admin,
      reporterType: "user",
      reporterId: 2,
      note: "  ",
    });
    expect(missing.ok).toBe(false);

    const denied = validateTransition({
      action: "reopen_invalid",
      from: "invalid",
      identity: reporter,
      reporterType: "user",
      reporterId: 2,
      note: "我想收回",
    });
    expect(denied.ok).toBe(false);

    const good = validateTransition({
      action: "reopen_invalid",
      from: "invalid",
      identity: admin,
      reporterType: "user",
      reporterId: 2,
      note: "漏看了附件里的报错截图",
    });
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.to).toBe("pending");
  });

  it("lets an admin withdraw a submitted fix without confirming it", () => {
    expect(allowedActions(admin, "awaiting_confirm", "user", 2)).toEqual([
      "withdraw_fix",
    ]);
    expect(allowedActions(reporter, "awaiting_confirm", "user", 2)).not.toContain(
      "withdraw_fix"
    );

    const good = validateTransition({
      action: "withdraw_fix",
      from: "awaiting_confirm",
      identity: admin,
      reporterType: "user",
      reporterId: 2,
      note: "说明写早了，列表上还有一处要改",
    });
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.to).toBe("fixing");

    const confirmed = validateTransition({
      action: "confirm_fix",
      from: "awaiting_confirm",
      identity: admin,
      reporterType: "user",
      reporterId: 2,
    });
    expect(confirmed.ok).toBe(false);
  });

  it("lets an admin ask for missing reporter material and only the reporter send it back", () => {
    expect(allowedActions(admin, "pending", "user", 2)).toContain("request_info");
    expect(allowedActions(admin, "fixing", "user", 2)).toContain("request_info");
    expect(allowedActions(reporter, "pending", "user", 2)).not.toContain(
      "request_info"
    );
    expect(allowedActions(reporter, "needs_info", "user", 2)).toEqual([
      "provide_info",
    ]);
    expect(allowedActions(other, "needs_info", "user", 2)).not.toContain(
      "provide_info"
    );
    expect(allowedActions(admin, "needs_info", "user", 2)).not.toContain(
      "provide_info"
    );

    const missing = validateTransition({
      action: "request_info",
      from: "pending",
      identity: admin,
      reporterType: "user",
      reporterId: 2,
      note: " ",
    });
    expect(missing.ok).toBe(false);

    const asked = validateTransition({
      action: "request_info",
      from: "fixing",
      identity: admin,
      reporterType: "user",
      reporterId: 2,
      note: "闪退只出现在这一台手机上，还缺崩溃记录",
    });
    expect(asked.ok).toBe(true);
    if (asked.ok) expect(asked.to).toBe("needs_info");

    const supplied = validateTransition({
      action: "provide_info",
      from: "needs_info",
      identity: reporter,
      reporterType: "user",
      reporterId: 2,
      note: "补上了同型号闪退时的崩溃记录",
    });
    expect(supplied.ok).toBe(true);
    if (supplied.ok) expect(supplied.to).toBe("pending");

    const tooSoon = validateTransition({
      action: "request_info",
      from: "awaiting_confirm",
      identity: admin,
      reporterType: "user",
      reporterId: 2,
      note: "还缺步骤",
    });
    expect(tooSoon.ok).toBe(false);
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
