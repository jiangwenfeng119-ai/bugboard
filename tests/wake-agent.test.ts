import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  assertWorkdir,
  buildLaunchArgv,
  readSession,
  sessionKey,
  signatureOk,
  sign,
  takeSessionId,
  usableSessionId,
  writeSession,
} from "../scripts/wake-agent.mjs";

const prompt = "这一轮由 Bugboard 叫醒。先处理这一张。";

describe("wake agent launch", () => {
  it("does not yolo reporter text, and keeps the run inside the project directory", () => {
    const args = buildLaunchArgv({
      agent: "cursor",
      argv: null,
      applyEdits: false,
      sessionId: "",
      vars: {
        prompt,
        cwd: "/work/counter",
        bugId: "4",
        publicId: "SOC-4",
        projectCode: "SOC",
      },
    });
    expect(args).not.toContain("--force");
    expect(args).not.toContain("--yolo");
    expect(args).not.toContain("-f");
    expect(args.slice(args.indexOf("--mode") + 1, args.indexOf("--mode") + 2)).toEqual(["plan"]);
    expect(args).toContain("--output-format");
    expect(args).toContain("json");
    expect(args).toContain("--sandbox");
    expect(args.slice(args.indexOf("--workspace") + 1, args.indexOf("--workspace") + 2)).toEqual(["/work/counter"]);
    expect(args.at(-1)).toBe(prompt);
  });

  it("strips force from a custom command unless edits are explicitly enabled", () => {
    const vars = {
      prompt,
      cwd: "/work/counter",
      bugId: "4",
      publicId: "SOC-4",
      projectCode: "SOC",
    };
    const locked = buildLaunchArgv({
      agent: "cursor",
      argv: ["agent", "-p", "--yolo", "--mode", "agent", "{prompt}"],
      applyEdits: false,
      sessionId: "sess_abc",
      vars,
    });
    expect(locked).not.toContain("--yolo");
    expect(locked).not.toContain("--force");
    expect(locked).toContain("--mode");
    expect(locked[locked.indexOf("--mode") + 1]).toBe("plan");
    expect(locked[locked.indexOf("--resume") + 1]).toBe("sess_abc");
    expect(locked[locked.indexOf("--workspace") + 1]).toBe("/work/counter");

    const editing = buildLaunchArgv({
      agent: "cursor",
      argv: null,
      applyEdits: true,
      sessionId: "",
      vars,
    });
    expect(editing).toContain("--force");
    expect(editing).not.toContain("--mode");
    expect(editing).toContain("--sandbox");
    expect(usableSessionId("--force")).toBe("");
  });

  it("checks the webhook signature and refuses a home or secret directory", () => {
    const body = JSON.stringify({ event: "bug.needs_agent" });
    const secret = "whsec_test";
    expect(signatureOk([secret], body, `sha256=${sign(secret, body)}`)).toBe(true);
    expect(signatureOk([secret], body, "sha256=00")).toBe(false);
    expect(signatureOk([secret], body, "")).toBe(false);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wake-work-"));
    expect(assertWorkdir(root)).toBe(fs.realpathSync(root));
    expect(() => assertWorkdir(os.homedir())).toThrow(/主目录或磁盘根目录/);
    expect(() => assertWorkdir(path.parse(root).root)).toThrow(/主目录或磁盘根目录/);
    fs.writeFileSync(path.join(root, "wake.config.json"), "{}");
    expect(() => assertWorkdir(root)).toThrow(/叫醒密钥/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("reuses a saved session id for the same bug", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wake-session-"));
    const file = path.join(dir, "wake.sessions.json");
    const key = sessionKey("SOC", "15");
    expect(key).toBe("bug:SOC:15");
    writeSession(file, key, "sess_abc");
    expect(readSession(file, key)).toBe("sess_abc");
    expect(takeSessionId(JSON.stringify({ session_id: "sess_next", result: "ok" }))).toBe("sess_next");
    writeSession(file, key, "--force");
    expect(readSession(file, key)).toBe("sess_abc");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
