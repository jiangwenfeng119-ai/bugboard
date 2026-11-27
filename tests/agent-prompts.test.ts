import { describe, expect, it } from "vitest";
import {
  ADMIN_AGENT_PROMPT,
  PROJECT_PLACEHOLDER,
  RELEASE_AGENT_PROMPT,
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
    expect(USER_AGENT_PROMPT).toContain("accept_invalid");
    expect(USER_AGENT_PROMPT).toContain("这张认可不属实");
    expect(USER_AGENT_PROMPT).toContain("acknowledged");
    expect(USER_AGENT_PROMPT).toContain("provide_info");
    expect(USER_AGENT_PROMPT).toContain("add_supplement");
    expect(USER_AGENT_PROMPT).toContain("没让它补，就不要写");
    expect(USER_AGENT_PROMPT).toContain("待产品经理确认");
    expect(USER_AGENT_PROMPT).not.toContain("待产品经理确认没有报障人动作");
    expect(USER_AGENT_PROMPT).toContain("needs_info");
    expect(USER_AGENT_PROMPT).toContain("awaiting_confirm");
  });

  it("assigns repair transitions to the admin prompt", () => {
    expect(ADMIN_AGENT_PROMPT).toContain("start_fix");
    expect(ADMIN_AGENT_PROMPT).toContain("submit_fix");
    expect(ADMIN_AGENT_PROMPT).toContain("mark_invalid");
    expect(ADMIN_AGENT_PROMPT).toContain("reopen_invalid");
    expect(ADMIN_AGENT_PROMPT).toContain("withdraw_fix");
    expect(ADMIN_AGENT_PROMPT).toContain("request_info");
    expect(ADMIN_AGENT_PROMPT).toContain("待补充");
    expect(ADMIN_AGENT_PROMPT).toContain("不要 request_info");
    expect(ADMIN_AGENT_PROMPT).toContain("只有报障人能提供");
    expect(ADMIN_AGENT_PROMPT).toContain("待确认");
    expect(ADMIN_AGENT_PROMPT).toContain("不要调用 accept_invalid");
    expect(ADMIN_AGENT_PROMPT).toContain("acknowledged");
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
    expect(ADMIN_AGENT_PROMPT).toContain("这张在等产品经理决定做不做");
    expect(ADMIN_AGENT_PROMPT).toContain("## 建议");
    expect(ADMIN_AGENT_PROMPT).toContain("建议不代替产品经理的决定");
    expect(ADMIN_AGENT_PROMPT).toContain("相邻功能");
    expect(ADMIN_AGENT_PROMPT).toContain("资料里没有的不要编");
    expect(ADMIN_AGENT_PROMPT).toContain("说明里没有建议就写明没有");
    expect(ADMIN_AGENT_PROMPT).toContain("报障人后补的说明");
    expect(ADMIN_AGENT_PROMPT).toContain("没有后补说明就写明没有");
    expect(ADMIN_AGENT_PROMPT).toContain("之后补的说明，都不算");
    expect(ADMIN_AGENT_PROMPT).toContain("页面上点了「可以做」也算已确认");
    expect(ADMIN_AGENT_PROMPT).toContain("不要再 request_product，也不要 start_fix");
    expect(ADMIN_AGENT_PROMPT).not.toContain("请和产品经理沟通是否要增加");
    expect(ADMIN_AGENT_PROMPT).toContain("已经和产品经理沟通确认");
    expect(ADMIN_AGENT_PROMPT).toContain("已经和 Marshal 确认");
    expect(ADMIN_AGENT_PROMPT).toContain("已经沟通确认");
    expect(ADMIN_AGENT_PROMPT).toContain("都不算确认");
    expect(ADMIN_AGENT_PROMPT).toContain("reporterIsProductManager");
    expect(ADMIN_AGENT_PROMPT).toContain("同样不算确认");
    expect(ADMIN_AGENT_PROMPT).toContain("不要调用 accept_product，也不要 decline_product");
    expect(ADMIN_AGENT_PROMPT).toContain("产品经理要在系统里点「可以做」或「不做」");
    expect(ADMIN_AGENT_PROMPT).not.toContain("信息够就按这张单要的新做法直接做");
    expect(ADMIN_AGENT_PROMPT).not.toContain("这张按需求做」也算");
    expect(USER_AGENT_PROMPT).toContain("不算产品决定");
    expect(ADMIN_AGENT_PROMPT).toContain("范围内每张单都有了结果");
    expect(ADMIN_AGENT_PROMPT).toContain("继续下一张");
    expect(ADMIN_AGENT_PROMPT).not.toContain("做完并回报后再做下一张");
    expect(ADMIN_AGENT_PROMPT).not.toContain("状态变为待确认后停止");
    expect(USER_AGENT_PROMPT).toContain("报障人和产品经理沟通");
    expect(USER_AGENT_PROMPT).toContain("product_manager");
    expect(USER_AGENT_PROMPT).toContain("dev_url");
    expect(USER_AGENT_PROMPT).toContain("test_url");
    expect(USER_AGENT_PROMPT).toContain("prod_url");
    expect(ADMIN_AGENT_PROMPT).toContain("github_url");
    expect(ADMIN_AGENT_PROMPT).toContain("agent_notes");
    expect(ADMIN_AGENT_PROMPT).toContain("verify_env");
    expect(ADMIN_AGENT_PROMPT).toContain("update_project_docs");
    expect(ADMIN_AGENT_PROMPT).toMatch(
      /update_project_docs：[\s\S]*description[\s\S]*product_manager[\s\S]*experience_officer[\s\S]*dev_url[\s\S]*test_url[\s\S]*prod_url[\s\S]*verify_env[\s\S]*agent_notes/
    );
    expect(ADMIN_AGENT_PROMPT).toContain("项目列表卡片");
    expect(ADMIN_AGENT_PROMPT).toContain(".md");
    expect(ADMIN_AGENT_PROMPT).toContain("upload_project_document");
    expect(ADMIN_AGENT_PROMPT).toContain("upload_project_logo");
    expect(ADMIN_AGENT_PROMPT).toContain("remove_project_logo");
    expect(USER_AGENT_PROMPT).toContain("upload_project_document");
    expect(USER_AGENT_PROMPT).toContain("upload_project_logo");
    expect(USER_AGENT_PROMPT).toContain("remove_project_logo");
    expect(USER_AGENT_PROMPT).toContain("本角色不调用");
    expect(USER_AGENT_PROMPT).toContain("范围内每张单都有了一行结果");
    expect(USER_AGENT_PROMPT).toContain("## 环境");
    expect(USER_AGENT_PROMPT).toContain("## 复现步骤");
    expect(USER_AGENT_PROMPT).toContain("## 期望");
    expect(USER_AGENT_PROMPT).toContain("## 实际");
    expect(ADMIN_AGENT_PROMPT).toContain("## 原来的问题");
    expect(ADMIN_AGENT_PROMPT).toContain("## 现在的表现");
    expect(ADMIN_AGENT_PROMPT).toContain("## 请这样重测");
    expect(ADMIN_AGENT_PROMPT).toContain("Markdown");
  });

  it("queues a pushed fix and keeps QA on awaiting confirm", () => {
    expect(ADMIN_AGENT_PROMPT).toContain("ready_to_release");
    expect(ADMIN_AGENT_PROMPT).toContain("修复中 → 待发布");
    expect(ADMIN_AGENT_PROMPT).toContain("commit 并 push");
    expect(ADMIN_AGENT_PROMPT).toContain("record_change（kind=fix");
    expect(ADMIN_AGENT_PROMPT).toContain("默认不要调用 run_release");
    expect(ADMIN_AGENT_PROMPT).toContain("入队等待本机发布任务");
    expect(ADMIN_AGENT_PROMPT).toContain("真正上线由发布 runner 完成后才会 markReleased");
    expect(ADMIN_AGENT_PROMPT).toContain("进待确认");
    expect(ADMIN_AGENT_PROMPT).toContain("不要说已发布");
    expect(ADMIN_AGENT_PROMPT).toContain("变成 awaiting_confirm");
    expect(ADMIN_AGENT_PROMPT).not.toContain("马上跑发布");
    expect(USER_AGENT_PROMPT).toContain("验收只处理 awaiting_confirm");
    expect(USER_AGENT_PROMPT).toContain("不要对待发布确认");
    expect(USER_AGENT_PROMPT).toContain("ready_to_release");
    expect(USER_AGENT_PROMPT).toContain("run_release、mark_released");
  });

  it("tells the fixer how to redo a release return", () => {
    expect(ADMIN_AGENT_PROMPT).toContain("release_return");
    expect(ADMIN_AGENT_PROMPT).toContain("发布退回");
    expect(ADMIN_AGENT_PROMPT).toContain("先读");
    expect(ADMIN_AGENT_PROMPT).toContain("已经撤回的提交不是还在的修复");
    expect(ADMIN_AGENT_PROMPT).toContain("release_hold");
    expect(ADMIN_AGENT_PROMPT).toContain("发布拦住");
    expect(ADMIN_AGENT_PROMPT).toContain("提交还在");
    expect(ADMIN_AGENT_PROMPT).toContain("不要删掉断言");
    expect(ADMIN_AGENT_PROMPT).toContain("失败不要 submit_fix");
    expect(ADMIN_AGENT_PROMPT).toContain("对应单测的 mock");
  });

  it("keeps the nightly release prompt inside the product", () => {
    expect(RELEASE_AGENT_PROMPT).toContain("不调用 confirm_fix");
    expect(RELEASE_AGENT_PROMPT).toContain("不调用 run_release");
    expect(RELEASE_AGENT_PROMPT).toContain("git revert");
    expect(RELEASE_AGENT_PROMPT).toContain("marshal.jiang@zhaoxuntec.com");
    expect(RELEASE_AGENT_PROMPT).toContain("result=failed");
    expect(RELEASE_AGENT_PROMPT).toContain("今晚没有待发布");
    expect(RELEASE_AGENT_PROMPT).toContain("git status --porcelain");
    expect(RELEASE_AGENT_PROMPT).toContain("git@host:path");
    expect(RELEASE_AGENT_PROMPT).toContain("release_return");
    expect(RELEASE_AGENT_PROMPT).toContain("请看是否介入");
    expect(RELEASE_AGENT_PROMPT).toContain("建议介入");
    expect(RELEASE_AGENT_PROMPT).toContain("不必介入");
    expect(RELEASE_AGENT_PROMPT).toContain("不连坐");
    expect(RELEASE_AGENT_PROMPT).toContain("不要猜测它本来是哪个提交");
    expect(RELEASE_AGENT_PROMPT).toContain("release-worktrees");
    expect(RELEASE_AGENT_PROMPT).toContain("已发布");
    expect(RELEASE_AGENT_PROMPT).toContain("旧测试还在用改之前的做法");
    expect(RELEASE_AGENT_PROMPT).toContain("不要为此撤回");
    expect(RELEASE_AGENT_PROMPT).toContain("不要改脚本里的默认主机");
    expect(RELEASE_AGENT_PROMPT).toContain("release_hold");
    expect(RELEASE_AGENT_PROMPT).toContain("content/training");
    expect(RELEASE_AGENT_PROMPT).toContain("开发目录的当前分支");
    expect(RELEASE_AGENT_PROMPT).toContain("不要删掉断言");
    expect(RELEASE_AGENT_PROMPT).toContain("已拦住并已叫醒");
  });
});
