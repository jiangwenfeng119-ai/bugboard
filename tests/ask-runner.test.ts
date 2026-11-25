import { createHmac } from "node:crypto";
import { EventEmitter } from "events";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { enqueueAsk, executeAsk, syncAskMirror } from "../scripts/ask-runner.mjs";

function gitOk(stdout = "") {
  return { code: 0, stdout, stderr: "" };
}

describe("ask runner", () => {
  it("clones when the mirror directory is missing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ask-root-"));
    const dir = path.join(root, "EMH");
    const calls: string[][] = [];
    const git = (_cwd: string, args: string[]) => {
      calls.push(args);
      if (args[0] === "rev-parse" && args[1] === "HEAD") return gitOk("abc1234\n");
      return gitOk();
    };
    const synced = syncAskMirror(
      {
        dir,
        askRoot: root,
        githubUrl: "https://github.com/acme/emh",
        defaultBranch: "release/1.0",
      },
      git
    );
    expect(synced.sha).toBe("abc1234");
    expect(calls.some((args) => args[0] === "clone" && args.includes("release/1.0"))).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("skips fetch when the mirror was just updated and is already current", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ask-root-"));
    const dir = path.join(root, "EMH");
    fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".git", "FETCH_HEAD"), "abc\n");
    const calls: string[][] = [];
    const git = (_cwd: string, args: string[]) => {
      calls.push(args);
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") return gitOk("true\n");
      if (args[0] === "remote") return gitOk("git@github.com:acme/emh.git\n");
      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return gitOk("release/1.0\n");
      if (args[0] === "status") return gitOk("");
      if (args[0] === "rev-list") return gitOk("0\t0\n");
      if (args[0] === "rev-parse" && args[1] === "HEAD") return gitOk("abc1234\n");
      return gitOk();
    };
    const synced = syncAskMirror(
      {
        dir,
        askRoot: root,
        githubUrl: "https://github.com/acme/emh",
        defaultBranch: "release/1.0",
      },
      git
    );
    expect(synced.sha).toBe("abc1234");
    expect(calls.some((args) => args[0] === "fetch")).toBe(false);
    const stale = syncAskMirror(
      {
        dir,
        askRoot: root,
        githubUrl: "https://github.com/acme/emh",
        defaultBranch: "release/1.0",
      },
      git,
      Date.now() + 3 * 60 * 1000
    );
    expect(stale.sha).toBe("abc1234");
    expect(calls.some((args) => args[0] === "fetch")).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("kills the agent and reports a revert when a write tool appears", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ask-root-"));
    const events: { kind?: string; text?: string }[] = [];
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: (signal?: string) => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => child.emit("close", 0);
    const git = (_cwd: string, args: string[]) => {
      if (args[0] === "rev-parse" && args[1] === "HEAD") return gitOk("abc1234\n");
      return gitOk();
    };
    const pending = executeAsk(
      {
        askRoot: root,
        bugboardUrl: "http://127.0.0.1:3080",
        secrets: ["whsec_test"],
      },
      {
        runId: 4,
        callbackUrl: "http://127.0.0.1:3080/api/ask/callback",
        prompt: "请根据当前默认分支列出功能模块和用户入口。\n<question>\n只回答\n</question>",
        project: {
          code: "EMH",
          githubUrl: "https://github.com/acme/emh",
          defaultBranch: "release/1.0",
        },
      },
      {
        git,
        post: async (_url: string, body: string) => {
          events.push(JSON.parse(body));
          return { status: 200, json: { skip: false } };
        },
        spawnAgent: () => {
          setImmediate(() => {
            child.stdout.emit(
              "data",
              `${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "先看" }] } })}\n`
            );
            child.stdout.emit(
              "data",
              `${JSON.stringify({ type: "tool_call", tool_call: { name: "Write", args: { path: "a.ts" } } })}\n`
            );
          });
          return child;
        },
      }
    );
    const result = await pending;
    expect(result.reverted).toBe(true);
    expect(events.some((event) => event.kind === "reverted")).toBe(true);
    expect(events.some((event) => event.kind === "done")).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("answers a question from file names without launching the agent", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ask-root-"));
    const events: { kind?: string; text?: string }[] = [];
    let launched = false;
    const git = (_cwd: string, args: string[]) => {
      if (args[0] === "rev-parse" && args[1] === "HEAD") return gitOk("abc1234\n");
      if (args[0] === "ls-files") return gitOk("docs/user-manual.md\n");
      if (args[0] === "grep") return gitOk("docs/user-manual.md:1:用户手册在文档目录\n");
      return gitOk();
    };
    const result = await executeAsk(
      {
        askRoot: root,
        bugboardUrl: "http://127.0.0.1:3080",
        secrets: ["whsec_other"],
        callbackSecret: "whsec_test",
      },
      {
        runId: 8,
        callbackUrl: "http://127.0.0.1:3080/api/ask/callback",
        prompt: "项目上传的文档摘录：\n手册入口见 docs/user-manual.md\n用户的问题在 <question> 里\n<question>\n用户手册在哪里啊\n</question>",
        project: {
          code: "EMH",
          githubUrl: "https://github.com/acme/emh",
          defaultBranch: "release/1.0",
        },
      },
      {
        git,
        post: async (_url: string, body: string, signature: string) => {
          events.push(JSON.parse(body));
          expect(signature).toBe(createHmac("sha256", "whsec_test").update(body).digest("hex"));
          return { status: 200, json: { skip: false } };
        },
        spawnAgent: () => {
          launched = true;
          throw new Error("不应该启动代理");
        },
      }
    );
    expect(result).toMatchObject({ fast: true, sha: "abc1234" });
    expect(launched).toBe(false);
    const done = events.find((event) => event.kind === "done");
    expect(done?.text).toContain("没有写清");
    expect(done?.text).not.toContain("docs/user-manual.md");
    expect(done?.text).toContain("判断：没有把握");
    expect(events.some((event) => event.kind === "status" && event.text === "正在查应用里的入口")).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("reads a menu table that sits far below the top of the manual", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ask-root-"));
    const dir = path.join(root, "EMH");
    fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
    fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".git", "FETCH_HEAD"), "fresh\n");
    const lines = Array.from({ length: 120 }, () => "");
    lines.push("| `/task-center/attendance` | **考勤打卡**（公司围栏上下班） |");
    fs.writeFileSync(path.join(dir, "docs", "admin-user-manual-zh.md"), lines.join("\n"));
    const events: { kind?: string; text?: string }[] = [];
    const git = (_cwd: string, args: string[]) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") return gitOk("true\n");
      if (args[0] === "remote") return gitOk("https://github.com/acme/emh\n");
      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return gitOk("release/1.0\n");
      if (args[0] === "status") return gitOk("");
      if (args[0] === "rev-parse" && args[1] === "HEAD") return gitOk("abc1234\n");
      if (args[0] === "ls-files") return gitOk("docs/admin-user-manual-zh.md\n");
      if (args[0] === "grep") return gitOk("docs/admin-user-manual-zh.md:121:考勤打卡\n");
      return gitOk();
    };
    await executeAsk(
      {
        askRoot: root,
        bugboardUrl: "http://127.0.0.1:3080",
        secrets: ["whsec_test"],
        callbackSecret: "whsec_test",
      },
      {
        runId: 9,
        callbackUrl: "http://127.0.0.1:3080/api/ask/callback",
        prompt: "<question>\n考勤打卡在哪里\n</question>",
        project: { code: "EMH", githubUrl: "https://github.com/acme/emh", defaultBranch: "release/1.0" },
      },
      {
        git,
        post: async (_url: string, body: string) => {
          events.push(JSON.parse(body));
          return { status: 200, json: { skip: false } };
        },
        spawnAgent: () => {
          throw new Error("不应该启动代理");
        },
      }
    );
    const done = events.find((event) => event.kind === "done");
    expect(done?.text).toContain("页面「考勤打卡」（/task-center/attendance）");
    expect(done?.text).toContain("判断：已经有了");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("checks a defect in the mirror and does not open the real project", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ask-root-"));
    const real = fs.mkdtempSync(path.join(os.tmpdir(), "real-repo-"));
    const events: { kind?: string; text?: string }[] = [];
    let cwd = "";
    let args: string[] = [];
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: (signal?: string) => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => child.emit("close", 0);
    const git = (_cwd: string, cmd: string[]) => {
      if (cmd[0] === "rev-parse" && cmd[1] === "HEAD") return gitOk("abc1234\n");
      return gitOk();
    };
    const pending = executeAsk(
      {
        askRoot: root,
        bugboardUrl: "http://127.0.0.1:3080",
        secrets: ["whsec_test"],
        callbackSecret: "whsec_test",
      },
      {
        runId: 21,
        callbackUrl: "http://127.0.0.1:3080/api/ask/callback",
        prompt: "<question>\n按钮没反应\n</question>",
        project: { code: "EMH", githubUrl: "https://github.com/acme/emh", defaultBranch: "release/1.0" },
      },
      {
        git,
        post: async (_url: string, body: string) => {
          events.push(JSON.parse(body));
          return { status: 200, json: { skip: false } };
        },
        spawnAgent: (command: string, argv: string[], workdir: string) => {
          cwd = workdir;
          args = [command, ...argv];
          setImmediate(() => {
            child.stdout.emit(
              "data",
              `${JSON.stringify({ type: "result", result: "停用没有反应。\n判断：建议报障" })}\n`
            );
            child.emit("close", 0);
          });
          return child;
        },
      }
    );
    const result = await pending;
    expect(result).toMatchObject({ sha: "abc1234" });
    expect(cwd).toBe(path.join(fs.realpathSync(root), "EMH"));
    expect(cwd.startsWith(fs.realpathSync(real))).toBe(false);
    expect(args).toContain("--mode");
    expect(args[args.indexOf("--mode") + 1]).toBe("ask");
    expect(args).toContain("--workspace");
    expect(args[args.indexOf("--workspace") + 1]).toBe(cwd);
    expect(args).not.toContain("--force");
    expect(args.join("\n")).toContain("问答镜像");
    expect(events.some((event) => event.kind === "status" && event.text === "正在对照项目代码")).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(real, { recursive: true, force: true });
  });

  it("sends images into the mirror inbox and still checks a menu question", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ask-root-"));
    let prompt = "";
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: (signal?: string) => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => child.emit("close", 0);
    const git = (_cwd: string, cmd: string[]) => {
      if (cmd[0] === "rev-parse" && cmd[1] === "HEAD") return gitOk("abc1234\n");
      return gitOk();
    };
    await executeAsk(
      {
        askRoot: root,
        bugboardUrl: "http://127.0.0.1:3080",
        secrets: ["whsec_test"],
        callbackSecret: "whsec_test",
      },
      {
        runId: 22,
        callbackUrl: "http://127.0.0.1:3080/api/ask/callback",
        prompt: "<question>\n用户手册在哪里\n</question>",
        images: [{ name: "shot.png", url: "http://127.0.0.1:3080/api/ask-images/22/shot.png?t=1" }],
        project: { code: "EMH", githubUrl: "https://github.com/acme/emh", defaultBranch: "release/1.0" },
      },
      {
        git,
        fetch: async () => ({ ok: true, arrayBuffer: async () => Uint8Array.from([1, 2, 3]) }),
        post: async () => ({ status: 200, json: { skip: false } }),
        spawnAgent: (_command: string, argv: string[]) => {
          prompt = argv[argv.length - 1] || "";
          setImmediate(() => {
            child.stdout.emit(
              "data",
              `${JSON.stringify({ type: "result", result: "截图是帮助页。\n判断：已经有了" })}\n`
            );
            child.emit("close", 0);
          });
          return child;
        },
      }
    );
    expect(prompt).toContain(".ask-inbox/shot.png");
    expect(fs.existsSync(path.join(root, "EMH", ".ask-inbox", "shot.png"))).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns the table answer when the mirror check runs out of time", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ask-root-"));
    const events: { kind?: string; text?: string }[] = [];
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: (signal?: string) => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => child.emit("close", 0);
    const git = (_cwd: string, cmd: string[]) => {
      if (cmd[0] === "rev-parse" && cmd[1] === "HEAD") return gitOk("abc1234\n");
      return gitOk();
    };
    const result = await executeAsk(
      {
        askRoot: root,
        bugboardUrl: "http://127.0.0.1:3080",
        secrets: ["whsec_test"],
        callbackSecret: "whsec_test",
      },
      {
        runId: 23,
        callbackUrl: "http://127.0.0.1:3080/api/ask/callback",
        prompt: "<question>\n按钮没反应\n</question>",
        project: { code: "EMH", githubUrl: "https://github.com/acme/emh", defaultBranch: "release/1.0" },
      },
      {
        agentTimeoutMs: 30,
        git,
        post: async (_url: string, body: string) => {
          events.push(JSON.parse(body));
          return { status: 200, json: { skip: false } };
        },
        spawnAgent: () => child,
      }
    );
    expect(result).toMatchObject({ fallback: true });
    const done = events.find((event) => event.kind === "done");
    expect(done?.text).toContain("代码对照没有在时限内完成。");
    expect(done?.text).toContain("判断：没有把握");
    expect(events.some((event) => event.kind === "reverted")).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("keeps a partial mirror answer when the deep check times out", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ask-root-"));
    const events: { kind?: string; text?: string }[] = [];
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: (signal?: string) => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => child.emit("close", 0);
    const git = (_cwd: string, cmd: string[]) => {
      if (cmd[0] === "rev-parse" && cmd[1] === "HEAD") return gitOk("abc1234\n");
      return gitOk();
    };
    const result = await executeAsk(
      {
        askRoot: root,
        bugboardUrl: "http://127.0.0.1:3080",
        secrets: ["whsec_test"],
        callbackSecret: "whsec_test",
      },
      {
        runId: 24,
        callbackUrl: "http://127.0.0.1:3080/api/ask/callback",
        prompt: "<question>\n如果0成本商品进行调拨是不是不会成功\n</question>",
        project: { code: "EMH", githubUrl: "https://github.com/acme/emh", defaultBranch: "release/1.0" },
      },
      {
        agentTimeoutMs: 80,
        git,
        post: async (_url: string, body: string) => {
          events.push(JSON.parse(body));
          return { status: 200, json: { skip: false } };
        },
        spawnAgent: () => {
          setImmediate(() => {
            child.stdout.emit(
              "data",
              `${JSON.stringify({
                type: "result",
                result: "现在可以这样做：\n调拨允许 0 成本商品\n判断：已经有了",
              })}\n`,
            );
          });
          return child;
        },
      },
    );
    expect(result).toMatchObject({ fallback: true });
    const done = events.find((event) => event.kind === "done");
    expect(done?.text).toContain("判断：已经有了");
    expect(done?.text).toContain("调拨允许 0 成本商品");
    expect(done?.text).not.toContain("代码对照没有在时限内完成。");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("does not make a user question wait for the feature map", async () => {
    let releaseMap: () => void = () => {};
    const mapGate = new Promise<void>((resolve) => {
      releaseMap = resolve;
    });
    const map = enqueueAsk("EMH", () => mapGate, "map");
    let userRan = false;
    await enqueueAsk("EMH", async () => {
      userRan = true;
    });
    expect(userRan).toBe(true);
    let mapDone = false;
    void map.then(() => {
      mapDone = true;
    });
    await Promise.resolve();
    expect(mapDone).toBe(false);
    releaseMap();
    await map;
  });
});
