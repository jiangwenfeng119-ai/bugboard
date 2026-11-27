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
  it("requires the caller to pass asAdmin instead of inferring it from the account role", () => {
    const superadmin: Identity = { ...admin, role: "superadmin" };
    expect(allowedActions(superadmin, "pending", "user", 2, false)).not.toContain("start_fix");
    expect(allowedActions(superadmin, "pending", "user", 2, true)).toContain("start_fix");
  });

  it("sends an unconfirmed new capability to the product manager", () => {
    expect(allowedActions(admin, "pending", "user", 2, admin.role !== "user")).toContain("request_product");
    expect(allowedActions(reporter, "needs_product", "user", 2, reporter.role !== "user")).not.toContain(
      "decline_product"
    );
    expect(allowedActions(admin, "needs_product", "user", 2, admin.role !== "user")).toEqual(
      expect.arrayContaining(["decline_product", "accept_product"])
    );

    const missing = validateTransition({
      action: "decline_product",
      from: "needs_product",
      identity: admin,
      reporterType: "user",
      reporterId: 2,
      asAdmin: admin.role !== "user",
    });
    expect(missing.ok).toBe(false);

    const declined = validateTransition({
      action: "decline_product",
      from: "needs_product",
      identity: admin,
      reporterType: "user",
      reporterId: 2,
      note: "这次不做",
      asAdmin: admin.role !== "user",
    });
    if (declined.ok) expect(declined.to).toBe("invalid");

    const accepted = validateTransition({
      action: "accept_product",
      from: "needs_product",
      identity: admin,
      reporterType: "user",
      reporterId: 2,
      asAdmin: admin.role !== "user",
    });
    if (accepted.ok) expect(accepted.to).toBe("fixing");
  });

  it("allows admin to start fix from pending", () => {
    const actions = allowedActions(admin, "pending", "user", 2, admin.role !== "user");
    expect(actions).toContain("start_fix");
    expect(actions).toContain("mark_invalid");
  });

  it("only reporter can confirm a ticket filed by a person", () => {
    expect(allowedActions(reporter, "awaiting_confirm", "user", 2, reporter.role !== "user")).toContain(
      "confirm_fix"
    );
    expect(allowedActions(other, "awaiting_confirm", "user", 2, other.role !== "user")).not.toContain(
      "confirm_fix"
    );
    expect(allowedActions(admin, "awaiting_confirm", "user", 2, true)).not.toContain(
      "confirm_fix"
    );
  });

  it("lets a project admin confirm a ticket filed by an api key", () => {
    const agent: Identity = {
      kind: "api_key",
      apiKeyId: 9,
      role: "user",
      name: "qa-agent",
      projectIds: [1],
    };
    expect(allowedActions(admin, "awaiting_confirm", "api_key", 9, true)).toContain(
      "confirm_fix"
    );
    expect(allowedActions(agent, "awaiting_confirm", "api_key", 9, false)).toContain(
      "confirm_fix"
    );
    expect(allowedActions(reporter, "awaiting_confirm", "api_key", 9, false)).not.toContain(
      "confirm_fix"
    );
    expect(allowedActions(admin, "awaiting_confirm", "api_key", 9, false)).not.toContain(
      "confirm_fix"
    );
    expect(allowedActions(admin, "awaiting_confirm", "api_key", 9, true)).not.toContain(
      "reject_fix"
    );

    const confirmed = validateTransition({
      action: "confirm_fix",
      from: "awaiting_confirm",
      identity: admin,
      reporterType: "api_key",
      reporterId: 9,
      asAdmin: true,
    });
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) expect(confirmed.to).toBe("confirmed");
  });

  it("lets an admin withdraw a wrong invalid mark back to pending", () => {
    expect(allowedActions(admin, "invalid", "user", 2, admin.role !== "user")).toContain(
      "reopen_invalid"
    );
    expect(allowedActions(reporter, "invalid", "user", 2, reporter.role !== "user")).not.toContain(
      "reopen_invalid"
    );
    expect(allowedActions(reporter, "invalid", "user", 2, reporter.role !== "user")).toContain(
      "dispute_invalid"
    );

    const missing = validateTransition({
      action: "reopen_invalid",
      from: "invalid",
      identity: admin,
      reporterType: "user",
      reporterId: 2,
      note: "  ",
      asAdmin: admin.role !== "user",
    });
    expect(missing.ok).toBe(false);

    const denied = validateTransition({
      action: "reopen_invalid",
      from: "invalid",
      identity: reporter,
      reporterType: "user",
      reporterId: 2,
      note: "我想收回",
      asAdmin: reporter.role !== "user",
    });
    expect(denied.ok).toBe(false);

    const good = validateTransition({
      action: "reopen_invalid",
      from: "invalid",
      identity: admin,
      reporterType: "user",
      reporterId: 2,
      note: "漏看了附件里的报错截图",
      asAdmin: admin.role !== "user",
    });
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.to).toBe("pending");
  });

  it("lets the reporter accept an invalid bug into a terminal state", () => {
    expect(allowedActions(reporter, "invalid", "user", 2, reporter.role !== "user")).toContain(
      "accept_invalid"
    );
    expect(allowedActions(admin, "invalid", "user", 2, admin.role !== "user")).not.toContain(
      "accept_invalid"
    );
    expect(allowedActions(other, "invalid", "user", 2, other.role !== "user")).not.toContain(
      "accept_invalid"
    );

    const accepted = validateTransition({
      action: "accept_invalid",
      from: "invalid",
      identity: reporter,
      reporterType: "user",
      reporterId: 2,
      asAdmin: reporter.role !== "user",
    });
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(accepted.to).toBe("acknowledged");

    const denied = validateTransition({
      action: "accept_invalid",
      from: "invalid",
      identity: admin,
      reporterType: "user",
      reporterId: 2,
      asAdmin: admin.role !== "user",
    });
    expect(denied.ok).toBe(false);

    const wrongStatus = validateTransition({
      action: "accept_invalid",
      from: "pending",
      identity: reporter,
      reporterType: "user",
      reporterId: 2,
      asAdmin: reporter.role !== "user",
    });
    expect(wrongStatus.ok).toBe(false);

    expect(
      allowedActions(reporter, "acknowledged", "user", 2, reporter.role !== "user")
    ).toEqual([]);
    expect(
      validateTransition({
        action: "dispute_invalid",
        from: "acknowledged",
        identity: reporter,
        reporterType: "user",
        reporterId: 2,
        note: "还是有问题",
        asAdmin: reporter.role !== "user",
    }).ok
    ).toBe(false);
    expect(
      validateTransition({
        action: "reopen_invalid",
        from: "acknowledged",
        identity: admin,
        reporterType: "user",
        reporterId: 2,
        note: "判错了",
        asAdmin: admin.role !== "user",
    }).ok
    ).toBe(false);
  });

  it("lets an admin withdraw a submitted fix without confirming it", () => {
    expect(allowedActions(admin, "ready_to_release", "user", 2, admin.role !== "user")).toEqual(
      expect.arrayContaining(["withdraw_fix"])
    );
    expect(allowedActions(reporter, "ready_to_release", "user", 2, reporter.role !== "user")).not.toContain(
      "withdraw_fix"
    );

    const good = validateTransition({
      action: "withdraw_fix",
      from: "ready_to_release",
      identity: admin,
      reporterType: "user",
      reporterId: 2,
      note: "说明写早了，列表上还有一处要改",
      asAdmin: admin.role !== "user",
    });
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.to).toBe("fixing");

    const confirmed = validateTransition({
      action: "confirm_fix",
      from: "awaiting_confirm",
      identity: admin,
      reporterType: "user",
      reporterId: 2,
      asAdmin: admin.role !== "user",
    });
    expect(confirmed.ok).toBe(false);
  });

  it("lets an admin ask for missing reporter material and only the reporter send it back", () => {
    expect(allowedActions(admin, "pending", "user", 2, admin.role !== "user")).toContain("request_info");
    expect(allowedActions(admin, "fixing", "user", 2, admin.role !== "user")).toContain("request_info");
    expect(allowedActions(reporter, "pending", "user", 2, reporter.role !== "user")).not.toContain(
      "request_info"
    );
    expect(allowedActions(reporter, "needs_info", "user", 2, reporter.role !== "user")).toEqual([
      "provide_info",
    ]);
    expect(allowedActions(other, "needs_info", "user", 2, other.role !== "user")).not.toContain(
      "provide_info"
    );
    expect(allowedActions(admin, "needs_info", "user", 2, admin.role !== "user")).not.toContain(
      "provide_info"
    );

    const missing = validateTransition({
      action: "request_info",
      from: "pending",
      identity: admin,
      reporterType: "user",
      reporterId: 2,
      note: " ",
      asAdmin: admin.role !== "user",
    });
    expect(missing.ok).toBe(false);

    const asked = validateTransition({
      action: "request_info",
      from: "fixing",
      identity: admin,
      reporterType: "user",
      reporterId: 2,
      note: "闪退只出现在这一台手机上，还缺崩溃记录",
      asAdmin: admin.role !== "user",
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
      asAdmin: reporter.role !== "user",
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
      asAdmin: admin.role !== "user",
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
      asAdmin: admin.role !== "user",
    });
    expect(bad.ok).toBe(false);

    const good = validateTransition({
      action: "mark_invalid",
      from: "pending",
      identity: admin,
      reporterType: "user",
      reporterId: 2,
      note: "无法复现",
      asAdmin: admin.role !== "user",
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
      asAdmin: admin.role !== "user",
    });
    expect(result.ok).toBe(false);
  });

  it("submit_fix goes to ready_to_release; release_fixes then awaiting_confirm", () => {
    const submitted = validateTransition({
      action: "submit_fix",
      from: "fixing",
      identity: admin,
      reporterType: "user",
      reporterId: 2,
      note: "已修好",
      asAdmin: admin.role !== "user",
    });
    expect(submitted.ok && submitted.to).toBe("ready_to_release");

    const released = validateTransition({
      action: "release_fixes",
      from: "ready_to_release",
      identity: admin,
      reporterType: "user",
      reporterId: 2,
      asAdmin: admin.role !== "user",
    });
    expect(released.ok && released.to).toBe("awaiting_confirm");

    expect(allowedActions(admin, "ready_to_release", "user", 2, admin.role !== "user")).toEqual(
      expect.arrayContaining(["release_fixes", "withdraw_fix"])
    );
    expect(allowedActions(reporter, "ready_to_release", "user", 2, reporter.role !== "user")).toEqual([]);
  });

  it("release_return goes from ready_to_release to pending and requires an admin note", () => {
    const returned = validateTransition({
      action: "release_return",
      from: "ready_to_release",
      identity: admin,
      reporterType: "user",
      reporterId: 2,
      note: "测试没过，撤回后重做",
      asAdmin: admin.role !== "user",
    });
    expect(returned.ok && returned.to).toBe("pending");

    const missing = validateTransition({
      action: "release_return",
      from: "ready_to_release",
      identity: admin,
      reporterType: "user",
      reporterId: 2,
      asAdmin: true,
    });
    expect(missing.ok).toBe(false);

    const member = validateTransition({
      action: "release_return",
      from: "ready_to_release",
      identity: reporter,
      reporterType: "user",
      reporterId: 2,
      note: "我想退回",
      asAdmin: false,
    });
    expect(member.ok).toBe(false);

    const wrong = validateTransition({
      action: "release_return",
      from: "fixing",
      identity: admin,
      reporterType: "user",
      reporterId: 2,
      note: "还不该退",
      asAdmin: true,
    });
    expect(wrong.ok).toBe(false);
  });

  it("release_hold goes from ready_to_release to fixing and requires an admin note", () => {
    const held = validateTransition({
      action: "release_hold",
      from: "ready_to_release",
      identity: admin,
      reporterType: "user",
      reporterId: 2,
      note: "旧测试还在用改之前的做法，断言要变绿",
      asAdmin: admin.role !== "user",
    });
    expect(held.ok && held.to).toBe("fixing");

    const missing = validateTransition({
      action: "release_hold",
      from: "ready_to_release",
      identity: admin,
      reporterType: "user",
      reporterId: 2,
      asAdmin: true,
    });
    expect(missing.ok).toBe(false);

    const member = validateTransition({
      action: "release_hold",
      from: "ready_to_release",
      identity: reporter,
      reporterType: "user",
      reporterId: 2,
      note: "我想拦住",
      asAdmin: false,
    });
    expect(member.ok).toBe(false);

    const wrong = validateTransition({
      action: "release_hold",
      from: "pending",
      identity: admin,
      reporterType: "user",
      reporterId: 2,
      note: "还不该拦",
      asAdmin: true,
    });
    expect(wrong.ok).toBe(false);
  });
});
