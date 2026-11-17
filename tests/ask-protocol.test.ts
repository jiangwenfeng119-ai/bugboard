import { describe, expect, it } from "vitest";
import {
  askGitSteps,
  buildAskArgv,
  callbackAllowed,
  parseAskStreamLine,
  planAskMirror,
} from "../scripts/ask-protocol.mjs";

describe("ask protocol", () => {
  it("clones a missing mirror on the project default branch", () => {
    const plan = planAskMirror({
      githubUrl: "https://github.com/jiangwenfeng119-ai/ENT-MGT-HUB",
      defaultBranch: "release/1.0",
      exists: false,
      isGit: false,
      originUrl: "",
      dirty: false,
      ahead: 0,
      behind: 0,
      headBranch: "",
    });
    expect(plan).toMatchObject({ action: "clone", branch: "release/1.0" });
    expect(askGitSteps(plan, "/mirrors/EMH", "/mirrors")[0].args).toEqual([
      "clone",
      "--single-branch",
      "--branch",
      "release/1.0",
      "git@github.com:jiangwenfeng119-ai/ENT-MGT-HUB",
      "/mirrors/EMH",
    ]);
  });

  it("fast-forwards a clean mirror and resets a dirty one", () => {
    const base = {
      githubUrl: "https://github.com/acme/app",
      defaultBranch: "main",
      exists: true,
      isGit: true,
      originUrl: "git@github.com:acme/app.git",
      headBranch: "main",
    };
    expect(planAskMirror({ ...base, dirty: false, ahead: 0, behind: 2 }).action).toBe("ff");
    expect(planAskMirror({ ...base, dirty: true, ahead: 0, behind: 0 }).action).toBe("reset");
    expect(planAskMirror({ ...base, githubUrl: "", dirty: false, ahead: 0, behind: 0 }).reason).toMatch(/没有代码仓/);
    expect(planAskMirror({ ...base, githubUrl: "file:///tmp/app", dirty: false, ahead: 0, behind: 0 }).action).toBe("refuse");
  });

  it("launches cursor ask mode with a stream and without write flags", () => {
    const args = buildAskArgv({
      cwd: "/mirrors/EMH",
      prompt: "只回答",
      sessionId: "sess_1",
    });
    expect(args).toContain("--mode");
    expect(args[args.indexOf("--mode") + 1]).toBe("ask");
    expect(args).toContain("stream-json");
    expect(args).toContain("--stream-partial-output");
    expect(args).not.toContain("--force");
    expect(args).not.toContain("--yolo");
    expect(args).not.toContain("--approve-mcps");
    expect(args[args.indexOf("--resume") + 1]).toBe("sess_1");
    expect(args.at(-1)).toBe("只回答");
  });

  it("treats a write tool as abort and a read as status", () => {
    expect(parseAskStreamLine('{"type":"tool_call","tool_call":{"name":"Write","args":{"path":"a.ts"}}}').kind).toBe(
      "write"
    );
    const read = parseAskStreamLine(
      '{"type":"tool_call","tool_call":{"readToolCall":{"args":{"path":"/work/src/app/page.tsx"}}}}'
    );
    expect(read).toMatchObject({ kind: "status", text: "正在查看 src/app/page.tsx" });
    const text = parseAskStreamLine('{"type":"assistant","message":{"content":[{"type":"text","text":"入口"}]}}');
    expect(text).toMatchObject({ kind: "text", text: "入口" });
    expect(callbackAllowed("http://evil.test/api/ask/callback", "http://127.0.0.1:3080")).toBe(false);
    expect(callbackAllowed("http://127.0.0.1:3080/api/ask/callback", "http://127.0.0.1:3080")).toBe(true);
    expect(callbackAllowed("http://127.0.0.1:3080/wake", "http://127.0.0.1:3080")).toBe(false);
  });
});
