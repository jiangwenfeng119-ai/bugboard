import { describe, expect, it } from "vitest";
import { explainDispatchDetail } from "../src/lib/dispatch-detail";

describe("explainDispatchDetail", () => {
  it("explains missing local project dir and keeps the raw detail", () => {
    const detail = "HTTP 500 没有配置项目 EMH 的本地目录（wake.config.json 的 projects）";
    expect(explainDispatchDetail(detail)).toBe(
      "在本机 wake.config.json 的 projects 里为 EMH 写上代码仓的绝对路径，保存后重启叫醒服务。原始：HTTP 500 没有配置项目 EMH 的本地目录（wake.config.json 的 projects）"
    );
  });

  it("falls back to 该项目 when the code is missing", () => {
    const detail = "HTTP 500 没有配置该项目的本地目录";
    expect(explainDispatchDetail(detail)).toBe(
      "在本机 wake.config.json 的 projects 里为该项目写上代码仓的绝对路径，保存后重启叫醒服务。原始：HTTP 500 没有配置该项目的本地目录"
    );
  });

  it("keeps connection hints and appends the raw detail", () => {
    expect(explainDispatchDetail("fetch failed")).toBe(
      "连不上这个地址（本机叫醒服务没在跑，或 Docker 要用 host.docker.internal）。原始：fetch failed"
    );
  });

  it("passes through unknown details unchanged", () => {
    expect(explainDispatchDetail("HTTP 500 agent 退出码 1")).toBe("HTTP 500 agent 退出码 1");
  });
});
