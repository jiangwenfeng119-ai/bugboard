import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LOGIN_THROTTLED,
  assertLoginAllowed,
  clearLoginFailures,
  recordLoginFailure,
  resetLoginThrottleForTests,
} from "../src/lib/login-throttle";
import { absoluteAttachmentPath, uploadResponseHeaders } from "../src/lib/uploads";

const tmpRoot = path.join(os.tmpdir(), `bugboard-hardening-${process.pid}`);

beforeEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(tmpRoot, { recursive: true });
  process.env.DATA_DIR = tmpRoot;
  process.env.DB_PATH = path.join(tmpRoot, "db", "test.sqlite");
  process.env.UPLOADS_DIR = path.join(tmpRoot, "uploads");
  resetLoginThrottleForTests();
});

afterEach(async () => {
  const { resetDbForTests } = await import("../src/lib/db");
  resetDbForTests();
  resetLoginThrottleForTests();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("upload safety", () => {
  it("keeps attachment paths inside the upload root and ignores client mime", () => {
    const abs = absoluteAttachmentPath(path.join("bug", "1", "note.txt"));
    expect(abs.startsWith(path.resolve(tmpRoot, "uploads"))).toBe(true);
    expect(() => absoluteAttachmentPath("../secret.txt")).toThrow(/路径无效/);
    expect(() => absoluteAttachmentPath("/etc/passwd")).toThrow(/路径无效/);

    const text = uploadResponseHeaders("note.txt", 4);
    expect(text["Content-Type"]).toBe("text/plain; charset=utf-8");
    expect(text["Content-Disposition"]).toContain("attachment");
    expect(text["X-Content-Type-Options"]).toBe("nosniff");

    const image = uploadResponseHeaders("shot.png", 8);
    expect(image["Content-Type"]).toBe("image/png");
    expect(image["Content-Disposition"]).toContain("inline");
  });
});

describe("login throttle", () => {
  it("locks a username after repeated failures and still counts the address", () => {
    for (let i = 0; i < 8; i += 1) recordLoginFailure("10.0.0.8", "ada");
    expect(() => assertLoginAllowed("10.0.0.9", "ada")).toThrow(LOGIN_THROTTLED);
    clearLoginFailures("ada");
    expect(() => assertLoginAllowed("10.0.0.9", "ada")).not.toThrow();
    for (let i = 0; i < 40; i += 1) recordLoginFailure("10.1.1.1", `user-${i}`);
    expect(() => assertLoginAllowed("10.1.1.1", "fresh")).toThrow(LOGIN_THROTTLED);
  });
});

describe("bug search", () => {
  it("treats % and _ as literal characters", async () => {
    const services = await import("../src/lib/services");
    const admin = await services.setupAdmin("admin", "secret1");
    const identity = {
      kind: "user" as const,
      userId: admin.id,
      role: "superadmin" as const,
      username: admin.username,
    };
    const project = services.createProject(identity, { name: "搜索", description: "" });
    services.createBug(identity, { projectId: project.id, title: "100% cpu" });
    services.createBug(identity, { projectId: project.id, title: "其他问题" });
    services.createBug(identity, { projectId: project.id, title: "a_b" });
    services.createBug(identity, { projectId: project.id, title: "axb" });

    const titles = (q: string) =>
      services.listBugs(identity, project.id, { q }).map((bug) => bug.title);

    expect(titles("%")).toEqual(["100% cpu"]);
    expect(titles("a_b")).toEqual(["a_b"]);
    expect(() =>
      services.createBug(identity, { projectId: project.id, title: "长".repeat(201) })
    ).toThrow(/标题不能超过/);
  });
});
