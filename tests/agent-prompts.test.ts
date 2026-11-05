import { describe, expect, it } from "vitest";
import {
  ADMIN_AGENT_PROMPT,
  PROJECT_PLACEHOLDER,
  USER_AGENT_PROMPT,
  applyProjectName,
} from "../src/lib/agent-prompts";

describe("agent prompts", () => {
  it("keeps a blank project line until a name is supplied", () => {
    expect(USER_AGENT_PROMPT).toContain(PROJECT_PLACEHOLDER);
    expect(ADMIN_AGENT_PROMPT).toContain(PROJECT_PLACEHOLDER);
    expect(applyProjectName(USER_AGENT_PROMPT, "  ")).toBe(USER_AGENT_PROMPT);
    expect(applyProjectName(USER_AGENT_PROMPT, "官网改版")).toContain(
      "目标项目：官网改版"
    );
    expect(applyProjectName(USER_AGENT_PROMPT, "官网改版")).not.toContain(
      PROJECT_PLACEHOLDER
    );
  });

  it("assigns filing and verification to the user prompt", () => {
    expect(USER_AGENT_PROMPT).toContain("create_bug");
    expect(USER_AGENT_PROMPT).toContain("confirm_fix");
    expect(USER_AGENT_PROMPT).toContain("reject_fix");
    expect(USER_AGENT_PROMPT).toContain("dispute_invalid");
    expect(USER_AGENT_PROMPT).toContain("awaiting_confirm");
  });

  it("assigns repair transitions to the admin prompt", () => {
    expect(ADMIN_AGENT_PROMPT).toContain("start_fix");
    expect(ADMIN_AGENT_PROMPT).toContain("submit_fix");
    expect(ADMIN_AGENT_PROMPT).toContain("mark_invalid");
    expect(ADMIN_AGENT_PROMPT).toContain("reopen_invalid");
    expect(ADMIN_AGENT_PROMPT).toContain("withdraw_fix");
    expect(ADMIN_AGENT_PROMPT).toContain("待确认");
  });

  it("asks the fixer to explain outcomes in the reporter's language", () => {
    expect(ADMIN_AGENT_PROMPT).toContain("原来的问题");
    expect(ADMIN_AGENT_PROMPT).toContain("现在的表现");
    expect(ADMIN_AGENT_PROMPT).toContain("请这样重测");
    expect(ADMIN_AGENT_PROMPT).toContain("不要写文件名、函数名、接口");
    expect(ADMIN_AGENT_PROMPT).toContain("实际做了什么、实际看到什么");
    expect(USER_AGENT_PROMPT).toContain("reopen_invalid、withdraw_fix");
  });

  it("treats a new capability as out of scope and finishes the whole batch", () => {
    expect(ADMIN_AGENT_PROMPT).toContain("改产品");
    expect(ADMIN_AGENT_PROMPT).toContain("请和产品经理沟通");
    expect(ADMIN_AGENT_PROMPT).toContain("这张按需求做");
    expect(ADMIN_AGENT_PROMPT).toContain("已经和产品经理沟通确认");
    expect(ADMIN_AGENT_PROMPT).toContain("已经和 Marshal 确认");
    expect(ADMIN_AGENT_PROMPT).toContain("已经沟通确认");
    expect(ADMIN_AGENT_PROMPT).toContain("范围内每张单都有了结果");
    expect(ADMIN_AGENT_PROMPT).toContain("继续下一张");
    expect(ADMIN_AGENT_PROMPT).not.toContain("做完并回报后再做下一张");
    expect(ADMIN_AGENT_PROMPT).not.toContain("状态变为待确认后停止");
    expect(USER_AGENT_PROMPT).toContain("报障人和产品经理沟通");
    expect(USER_AGENT_PROMPT).toContain("范围内每张单都有了一行结果");
  });
});
