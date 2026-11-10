import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  assertAgentCommand,
  assertWorkdir,
  buildLaunchArgv,
  createWakeServer,
  planAgentLaunches,
  readSession,
  resolveAgents,
  sessionKey,
  sessionKeyFor,
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

  it("organizes a walkthrough with plan mode and tries the next local agent", () => {
    const vars = {
      prompt: "这一轮只整理走查。不要创建报障，不要改代码。",
      cwd: "/work/counter",
      bugId: "",
      publicId: "",
      projectCode: "SOC",
    };
    expect(sessionKeyFor("capture.needs_organize", "SOC", "9")).toBe("capture:SOC:9");
    expect(sessionKeyFor("bug.needs_agent", "SOC", "9")).toBe("bug:SOC:9");
    expect(resolveAgents(undefined, "cursor")).toEqual([{ kind: "cursor", command: "" }]);
    expect(resolveAgents([], "cursor")).toEqual([]);

    const launches = planAgentLaunches({
      agents: [
        { kind: "cursor", command: "" },
        { kind: "zcode", command: "" },
        { kind: "command", command: "my-agent" },
      ],
      job: "organize",
      applyEdits: true,
      sessionId: "sess_fix",
      vars,
    });
    expect(launches).toHaveLength(3);
    expect(launches[0].args).toContain("--mode");
    expect(launches[0].args[launches[0].args.indexOf("--mode") + 1]).toBe("plan");
    expect(launches[0].args).not.toContain("--force");
    expect(launches[0].args).not.toContain("--resume");
    expect(launches[0].args).not.toContain("sess_fix");
    expect(launches[1].command).toBe("zcode");
    expect(launches[1].args).not.toContain("--force");
    expect(launches[2]).toEqual({ command: "my-agent", args: [vars.prompt] });
    expect(() => assertAgentCommand("bash")).toThrow(/不能用这个命令/);
    expect(() => assertAgentCommand("../agent")).toThrow(/命令无效/);
  });

  it("refuses to launch a shell when asked to organize a walkthrough", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wake-http-"));
    const config = {
      listen: "127.0.0.1:0",
      agent: "cursor",
      argv: null,
      allowLan: false,
      applyEdits: true,
      secrets: ["whsec_test"],
      cwd: "",
      projects: { SOC: root },
      sessionFile: path.join(root, "sessions.json"),
      runDir: path.join(root, "runs"),
    };
    const server = createWakeServer(config);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const body = JSON.stringify({
      event: "capture.needs_organize",
      project: { code: "SOC", id: 1, name: "柜台" },
      capture: { id: 3 },
      prompt: "只整理走查。不要创建报障，不要修改代码。",
      agents: [{ kind: "command", command: "bash" }],
    });
    const res = await fetch(`http://127.0.0.1:${port}/wake`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bugboard-Signature": `sha256=${sign("whsec_test", body)}`,
      },
      body,
    });
    const payload = (await res.json()) as { error?: string };
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
    expect(res.status).toBe(400);
    expect(payload.error).toMatch(/不能用这个命令/);
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
