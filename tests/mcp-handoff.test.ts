import { describe, expect, it } from "vitest";
import {
  buildMcpHandoff,
  mcpServerId,
  resolveBugboardBaseUrl,
} from "../src/lib/mcp-handoff";

const base = {
  baseUrl: "https://bugboard.example",
  keyId: 4,
  keyName: "cursor-qa",
  role: "user" as const,
  projectNames: ["官网", "App"],
  keyPrefix: "bb_abc1234",
  rawKey: "bb_abc1234fullsecret",
  mcpScriptPath: "/Users/shzx/Apps/bugboard/mcp/server.ts",
  status: "active" as const,
};

describe("mcp handoff", () => {
  it("names the server from the key name", () => {
    expect(mcpServerId("cursor-qa", "user", 4)).toBe("bugboard-cursor-qa");
    expect(mcpServerId("提报", "user", 9)).toBe("bugboard-qa-9");
    expect(mcpServerId("修复", "admin", 2)).toBe("bugboard-fixer-2");
  });

  it("uses the public URL when the admin page is on loopback", () => {
    expect(
      resolveBugboardBaseUrl(
        "http://127.0.0.1:3080",
        "http://192.168.166.8:3080/"
      )
    ).toBe("http://192.168.166.8:3080");
    expect(
      resolveBugboardBaseUrl(
        "https://bugboard.zhaoxuntec.com",
        "http://192.168.166.8:3080"
      )
    ).toBe("https://bugboard.zhaoxuntec.com");
  });

  it("copies url, key, role, projects, and a paste-ready mcp.json", () => {
    const text = buildMcpHandoff(base);
    expect(text).toContain("服务地址：https://bugboard.example");
    expect(text).toContain("API Key：bb_abc1234fullsecret");
    expect(text).toContain("可访问项目：官网、App");
    expect(text).toContain("角色：用户级");
    expect(text).toContain('"/Users/shzx/Apps/bugboard/mcp/server.ts"');
    expect(text).toContain('"BUGBOARD_BASE_URL": "https://bugboard.example"');
    expect(text).toContain('"BUGBOARD_API_KEY": "bb_abc1234fullsecret"');
    expect(text).toContain('"bugboard-cursor-qa"');
    expect(text).toContain("不能接单或提交修复");
  });

  it("does not invent a plaintext key that was not shown", () => {
    const text = buildMcpHandoff({
      ...base,
      role: "admin",
      rawKey: null,
      mcpScriptPath: null,
      projectNames: [],
    });
    expect(text).not.toContain("bb_abc1234fullsecret");
    expect(text).toContain("未包含明文");
    expect(text).toContain("此前缀 bb_abc1234");
    expect(text).toContain("REPLACE_WITH_FULL_KEY");
    expect(text).toContain("可访问项目：全部项目");
    expect(text).toContain("<本机 Bugboard 仓库绝对路径>/mcp/server.ts");
    expect(text).toContain("start_fix");
  });

  it("warns when the key cannot connect yet", () => {
    expect(buildMcpHandoff({ ...base, status: "disabled" })).toContain(
      "禁用状态"
    );
  });
});
