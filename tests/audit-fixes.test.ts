import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertDeployExecutable, DEPLOY_SHELLS } from "../src/lib/deploy-command";
import { assertLocalAgentCommand, assertWebhookUrl } from "../src/lib/dispatch";
import { publicErrorMessage, statusForMessage } from "../src/lib/http";
import {
  assertLoginAllowed,
  clientIpFromHeaders,
  LOGIN_THROTTLED,
  recordLoginFailure,
  resetLoginThrottleForTests,
} from "../src/lib/login-throttle";
import { assertAgentCommand, writeSession } from "../scripts/wake-agent.mjs";

const tmpRoot = path.join(os.tmpdir(), `bugboard-audit-${process.pid}`);

beforeEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(tmpRoot, { recursive: true });
  process.env.DATA_DIR = tmpRoot;
  process.env.DB_PATH = path.join(tmpRoot, "db", "test.sqlite");
  process.env.UPLOADS_DIR = path.join(tmpRoot, "uploads");
  delete process.env.BUGBOARD_TRUST_PROXY;
});

afterEach(async () => {
  resetLoginThrottleForTests();
  const { resetDbForTests } = await import("../src/lib/db");
  resetDbForTests();
  delete process.env.BUGBOARD_TRUST_PROXY;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("audit fixes", () => {
  it("ignores forwarded addresses unless the proxy is trusted", () => {
    const headers = new Headers({
      "x-real-ip": "203.0.113.8",
      "x-forwarded-for": "203.0.113.9, 10.0.0.8",
    });
    expect(clientIpFromHeaders(headers)).toBe("direct");
    process.env.BUGBOARD_TRUST_PROXY = "1";
    expect(clientIpFromHeaders(headers)).toBe("203.0.113.8");
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.8" }))).toBe(
      "10.0.0.8"
    );
  });

  it("keeps login failures in sqlite and caps a username without an ip bucket", () => {
    for (let i = 0; i < 8; i += 1) recordLoginFailure("direct", "nobody");
    expect(() => assertLoginAllowed("direct", "nobody")).toThrow(LOGIN_THROTTLED);
    expect(() => assertLoginAllowed("203.0.113.8", "someone-else")).not.toThrow();
  });

  it("rejects metadata webhook hosts in decimal, hex, and mapped forms", () => {
    expect(assertWebhookUrl("http://127.0.0.1:3099/wake")).toBe("http://127.0.0.1:3099/wake");
    expect(() => assertWebhookUrl("http://169.254.169.254/latest")).toThrow(/元数据/);
    expect(() => assertWebhookUrl("http://2852039166/latest")).toThrow(/元数据/);
    expect(() => assertWebhookUrl("http://0xa9fea9fe/latest")).toThrow(/元数据/);
    expect(() => assertWebhookUrl("http://[::ffff:169.254.169.254]/latest")).toThrow(/元数据/);
    expect(() => assertWebhookUrl("http://metadata.google.internal/")).toThrow(/元数据/);
    expect(() => assertWebhookUrl("http://[fd00:ec2::254]/latest")).toThrow(/元数据/);
  });

  it("maps driver errors and exact permission text to stable HTTP statuses", () => {
    expect(publicErrorMessage("UNIQUE constraint failed: projects.slug")).toBe("请求冲突，请重试");
    expect(statusForMessage("无权访问该项目")).toBe(403);
    expect(statusForMessage("只有超级管理员可以创建管理员级 Key")).toBe(403);
    expect(statusForMessage("项目不存在")).toBe(404);
    expect(statusForMessage("说明里不小心写了不存在这两个字")).toBe(400);
    expect(statusForMessage("需要补充说明")).toBe(400);
  });

  it("uses one shell denylist for deploy, dispatch, and the wake service", () => {
    expect(() => assertDeployExecutable("/usr/bin/dash")).toThrow(/shell/);
    expect(() => assertLocalAgentCommand("dash")).toThrow(/命令/);
    expect(() => assertAgentCommand("tcsh")).toThrow(/命令/);
    const wake = fs.readFileSync(path.join(process.cwd(), "scripts/wake-agent.mjs"), "utf8");
    for (const name of DEPLOY_SHELLS) expect(wake).toContain(`"${name}"`);
  });

  it("keeps capture session keys when the wake service writes another session", () => {
    const file = path.join(tmpRoot, "sessions.json");
    writeSession(file, "capture:SOC:4", "sess_capture");
    writeSession(file, "bug:SOC:9", "sess_bug");
    const saved = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>;
    expect(saved["capture:SOC:4"]).toBe("sess_capture");
    expect(saved["bug:SOC:9"]).toBe("sess_bug");
  });

  it("closes the reported service gaps", async () => {
    const services = await import("../src/lib/services");
    const widget = await import("../src/lib/widget");
    const staged = await import("../src/lib/staged");
    const { getDb } = await import("../src/lib/db");
    const admin = await services.setupAdmin("root", "secret1");
    const root = {
      kind: "user" as const,
      userId: admin.id,
      role: "superadmin" as const,
      username: admin.username,
    };
    const labeled = { ...root, role: "admin" as const };
    const accountAdmin = await services.createUser(root, {
      username: "ops",
      password: "secret1",
      role: "admin",
    });
    const ops = {
      kind: "user" as const,
      userId: accountAdmin.id,
      role: "admin" as const,
      username: accountAdmin.username,
    };
    const project = services.createProject(root, { name: "Atlas", code: "SOC" });
    services.addMember(root, project.id, root.userId, "admin");
    services.addMember(root, project.id, ops.userId, "user");
    expect(() => services.addMember(root, project.id, ops.userId, "admin")).toThrow(/已是成员/);

    expect(() => services.createApiKey(ops, { name: "fixer", role: "admin" })).toThrow(
      "只有超级管理员可以创建管理员级 Key"
    );
    const userKey = services.createApiKey(ops, {
      name: "qa",
      role: "user",
      projectIds: [project.id],
    });
    expect(userKey.rawKey).toMatch(/^bb_/);
    expect(services.createApiKey(labeled, { name: "root-fixer", role: "admin" }).rawKey).toMatch(/^bb_/);

    const bug = services.createBug(ops, {
      projectId: project.id,
      title: "按钮没反应",
      body: "点了没变化",
    });
    expect(() => services.addBugSupplement(root, bug.id, "x".repeat(20_001))).toThrow(/不能超过/);

    const db = getDb();
    const proto = Object.getPrototypeOf(db) as { prepare: (sql: string) => { run: (...args: unknown[]) => unknown; get: (...args: unknown[]) => unknown } };
    const original = proto.prepare;
    let armed = true;
    proto.prepare = function (this: unknown, sql: string) {
      if (armed && sql === "SELECT status FROM bugs WHERE id = ?") {
        armed = false;
        original.call(this, "UPDATE bugs SET status = 'invalid' WHERE id = ?").run(bug.id);
      }
      return original.call(this, sql);
    };
    try {
      expect(() =>
        services.transitionBug(root, bug.id, "start_fix", "接手", [
          { filename: "shot.png", buffer: Buffer.from("png") },
        ])
      ).toThrow("报障状态已变化，请刷新后再试");
    } finally {
      proto.prepare = original;
    }
    expect(services.getBug(root, bug.id).status).toBe("pending");
    expect(
      (db.prepare("SELECT COUNT(*) AS c FROM attachments").get() as { c: number }).c
    ).toBe(0);

    services.transitionBug(root, bug.id, "start_fix", "接手", [
      { filename: "shot.png", buffer: Buffer.from("png") },
    ]);
    expect(services.getBug(root, bug.id).status).toBe("fixing");
    expect(
      (db.prepare("SELECT COUNT(*) AS c FROM attachments").get() as { c: number }).c
    ).toBe(1);

    const version = await services.changeOwnPassword(root, {
      currentPassword: "secret1",
      newPassword: "secret2",
    });
    expect(
      (db.prepare("SELECT session_version AS v FROM users WHERE id = ?").get(admin.id) as { v: number }).v
    ).toBe(version);

    const token = widget.ensureWidgetToken(ops, project.id).token;
    const reported = widget.createWidgetReport(token, {
      ip: "direct",
      note: "页面空白",
      consoleText: "token=secret",
    });
    expect(reported.body).not.toContain("token=secret");
    services.deleteUser(root, ops.userId);
    const cleared = db
      .prepare("SELECT widget_token, widget_owner_user_id FROM projects WHERE id = ?")
      .get(project.id) as { widget_token: string | null; widget_owner_user_id: number | null };
    expect(cleared.widget_token).toBeNull();
    expect(cleared.widget_owner_user_id).toBeNull();

    const stagedRow = staged.stageUpload(root, project.id, {
      filename: "later.png",
      buffer: Buffer.from("png"),
    });
    db.prepare("UPDATE staged_uploads SET created_at = ? WHERE id = ?").run("2000-01-01T00:00:00.000Z", stagedRow.id);
    staged.sweepStagedUploads();
    expect(db.prepare("SELECT id FROM staged_uploads WHERE id = ?").get(stagedRow.id)).toBeUndefined();

    for (let i = 0; i < 60; i += 1) widget.assertWidgetRate("tok", "direct");
    expect(() => widget.assertWidgetRate("tok", "direct")).toThrow(/频繁/);
  });
});
