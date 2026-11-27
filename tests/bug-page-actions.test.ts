import { describe, expect, it } from "vitest";
import {
  bugPageActions,
  isDangerBugAction,
  nextStepButtonClass,
  primaryBugAction,
  productWaitCopy,
  retestNoteFromEvents,
  supplementNoteHint,
} from "../src/app/bugs/[id]/bug-page-actions";
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
    const allowed = allowedActions(admin, "ready_to_release", "user", 2, admin.role !== "user");
    expect(allowed).toContain("release_fixes");
    expect(allowed).toContain("withdraw_fix");
    const shown = bugPageActions(allowed);
    expect(shown).not.toContain("release_fixes");
    expect(shown).toContain("withdraw_fix");
    expect(shown).toContain("release_return");
    expect(shown).toContain("release_hold");
    expect(bugPageActions(shown)).toEqual(shown);
  });

  it("orders progress before danger and picks one primary", () => {
    const shown = bugPageActions([
      "decline_product",
      "accept_product",
      "request_info",
      "mark_invalid",
    ]);
    expect(shown[0]).toBe("accept_product");
    expect(shown.at(-1)).toBe("decline_product");
    expect(primaryBugAction(shown)).toBe("accept_product");
    expect(isDangerBugAction("decline_product")).toBe(true);
    expect(isDangerBugAction("accept_product")).toBe(false);
  });

  it("keeps one solid primary at rest and marks the open action", () => {
    const primary = "submit_fix" as const;
    expect(
      nextStepButtonClass("submit_fix", { active: null, primary })
    ).toBe("bb-btn");
    expect(
      nextStepButtonClass("mark_invalid", { active: null, primary })
    ).toBe("bb-btn bb-btn-danger-quiet");
    expect(
      nextStepButtonClass("request_product", { active: null, primary })
    ).toBe("bb-btn bb-btn-secondary");
    expect(
      nextStepButtonClass("mark_invalid", {
        active: "mark_invalid",
        primary,
      })
    ).toBe("bb-btn bb-btn-danger is-selected");
    expect(
      nextStepButtonClass("submit_fix", {
        active: "mark_invalid",
        primary,
      })
    ).toBe("bb-btn bb-btn-secondary");
    expect(
      nextStepButtonClass("submit_fix", {
        active: "submit_fix",
        primary,
      })
    ).toBe("bb-btn is-selected");
  });

  it("names who a needs-product bug is waiting on", () => {
    expect(productWaitCopy("周产品")).toBe("等 周产品 点可以做或不做");
    expect(productWaitCopy("  ")).toBe("等 产品经理 点可以做或不做");
  });

  it("prefers a real confirm note, otherwise the fix note", () => {
    expect(
      retestNoteFromEvents([
        { to_status: "ready_to_release", note: "## 请这样重测\n1. 打开日志" },
        { to_status: "awaiting_confirm", note: "已发到验收环境" },
      ])
    ).toBe("已发到验收环境");
    expect(
      retestNoteFromEvents([
        { to_status: "ready_to_release", note: "## 请这样重测\n1. 打开日志" },
        { to_status: "awaiting_confirm", note: "发布后待确认" },
      ])
    ).toBe("## 请这样重测\n1. 打开日志");
    expect(retestNoteFromEvents([{ to_status: "pending", note: "创建报障" }])).toBe("");
  });

  it("tells the reporter the product-manager note stays on the same bug", () => {
    expect(supplementNoteHint("pending")).toContain("写给处理人和 Agent");
    expect(supplementNoteHint("pending")).toContain("不改变状态");
    const product = supplementNoteHint("needs_product");
    expect(product).toContain("写给产品经理");
    expect(product).toContain("待产品经理确认");
    expect(product).toContain("可以做");
    expect(product).toContain("不做");
  });
});
