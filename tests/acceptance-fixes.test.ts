import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nextStepIdleCopy } from "../src/app/bugs/[id]/bug-page-actions";
import { changesEmptyDescription } from "../src/lib/release-ui";
import { setupPageRedirect } from "../src/lib/setup-entry";

const tmpRoot = path.join(os.tmpdir(), `bugboard-accept-fix-${process.pid}`);

beforeEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(tmpRoot, { recursive: true });
  process.env.DATA_DIR = tmpRoot;
  process.env.DB_PATH = path.join(tmpRoot, "db", "test.sqlite");
  process.env.UPLOADS_DIR = path.join(tmpRoot, "uploads");
});

afterEach(async () => {
  const { resetDbForTests } = await import("../src/lib/db");
  resetDbForTests();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("account credential errors", () => {
  it("names only the password when the username is already filled", async () => {
    const services = await import("../src/lib/services");
    await expect(services.setupAdmin("qa-admin", "12345")).rejects.toThrow("密码至少 6 位");
    await expect(services.setupAdmin("qa-admin", "12345")).rejects.not.toThrow(/用户名必填/);
  });

  it("keeps both reasons when the username is empty and the password is short", async () => {
    const services = await import("../src/lib/services");
    await expect(services.setupAdmin("  ", "12345")).rejects.toThrow(
      "用户名必填，密码至少 6 位"
    );
  });

  it("uses the same password-only message when an admin creates a user", async () => {
    const services = await import("../src/lib/services");
    const admin = await services.setupAdmin("qa-admin", "secret1");
    const adminId = {
      kind: "user" as const,
      userId: admin.id,
      role: "superadmin" as const,
      username: admin.username,
    };
    await expect(
      services.createUser(adminId, { username: "qa-short", password: "12345", role: "user" })
    ).rejects.toThrow(/^密码至少 6 位$/);
  });
});

describe("closed bug next step", () => {
  it("does not promise another turn after the ticket is finished", () => {
    expect(nextStepIdleCopy("confirmed")).toContain("已经结束");
    expect(nextStepIdleCopy("confirmed")).not.toContain("轮到你");
    expect(nextStepIdleCopy("acknowledged")).not.toContain("轮到你");
    expect(nextStepIdleCopy("fixing")).toContain("轮到你");
  });
});

describe("changes empty copy", () => {
  it("does not say pending bugs will appear when they are already listed", () => {
    const text = changesEmptyDescription({
      filtered: false,
      canRelease: true,
      pendingCount: 1,
    });
    expect(text).toContain("已经列在上方");
    expect(text).not.toContain("会出现在上方");
  });

  it("still explains where pending bugs show up when there are none", () => {
    expect(
      changesEmptyDescription({ filtered: false, canRelease: true, pendingCount: 0 })
    ).toContain("会出现在上方");
  });
});

describe("setup page after install", () => {
  it("sends a signed-in visitor to projects and everyone else to login", () => {
    expect(setupPageRedirect(false, false)).toBeNull();
    expect(setupPageRedirect(true, true)).toBe("/projects");
    expect(setupPageRedirect(true, false)).toBe("/login");
  });
});

describe("login auth visual", () => {
  it("keeps the illustration form with a password reveal control", () => {
    const login = fs.readFileSync(
      path.join(process.cwd(), "src/app/login/page.tsx"),
      "utf8"
    );
    const hero = fs.readFileSync(
      path.join(process.cwd(), "public/brand/auth-hero.svg"),
      "utf8"
    );
    expect(login).toContain("auth-hero");
    expect(login).toContain("PasswordField");
    expect(login).not.toContain("AuthStory");
    expect(hero).toContain("待发布");
    expect(hero).toContain("待产品经理确认");
    expect(hero).toContain("Agent 自动处理");
    expect(hero).toContain("人在回路");
  });
});
