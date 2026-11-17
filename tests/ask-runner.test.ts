import { EventEmitter } from "events";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { executeAsk, syncAskMirror } from "../scripts/ask-runner.mjs";

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
        prompt: "只回答",
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
});
