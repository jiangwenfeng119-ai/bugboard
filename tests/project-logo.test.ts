import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LOGO_MAX_BYTES } from "../src/lib/project-logo-shared";

const tmpRoot = path.join(os.tmpdir(), `bugboard-logo-${process.pid}`);

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

function pngBytes(size = 16) {
  const buf = Buffer.alloc(size);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf);
  return buf;
}

function jpegBytes() {
  const buf = Buffer.alloc(8);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  return buf;
}

function webpBytes() {
  const buf = Buffer.alloc(16);
  buf.write("RIFF", 0);
  buf.write("WEBP", 8);
  return buf;
}

describe("project logo", () => {
  it("stores one image, replaces it, and hides the disk path", async () => {
    const services = await import("../src/lib/services");
    const logos = await import("../src/lib/project-logo");
    const uploads = await import("../src/lib/uploads");
    const admin = await services.setupAdmin("admin", "secret1");
    const adminId = {
      kind: "user" as const,
      userId: admin.id,
      role: "superadmin" as const,
      username: admin.username,
    };
    const project = services.createProject(adminId, { name: "Bugboard" });

    const first = logos.setProjectLogo(adminId, project.id, {
      filename: "mark.png",
      buffer: pngBytes(),
    });
    expect(first.has_logo).toBe(true);
    const stored = services.getProject(adminId, project.id);
    expect(stored.logo_path.endsWith(".png")).toBe(true);
    expect(fs.existsSync(uploads.absoluteAttachmentPath(stored.logo_path))).toBe(true);
    expect(logos.toPublicProject(stored)).toMatchObject({ has_logo: true });
    expect(logos.toPublicProject(stored)).not.toHaveProperty("logo_path");

    logos.setProjectLogo(adminId, project.id, {
      filename: "photo.jpg",
      buffer: jpegBytes(),
    });
    const replaced = services.getProject(adminId, project.id);
    expect(replaced.logo_path.endsWith(".jpg")).toBe(true);
    expect(fs.existsSync(uploads.absoluteAttachmentPath(stored.logo_path))).toBe(false);
    expect(fs.existsSync(uploads.absoluteAttachmentPath(replaced.logo_path))).toBe(true);

    logos.setProjectLogo(adminId, project.id, {
      filename: "mark.webp",
      buffer: webpBytes(),
    });
    const webp = services.getProject(adminId, project.id);
    expect(webp.logo_path.endsWith(".webp")).toBe(true);

    const removed = logos.removeProjectLogo(adminId, project.id);
    expect(removed.has_logo).toBe(false);
    expect(services.getProject(adminId, project.id).logo_path).toBe("");
    expect(fs.existsSync(uploads.absoluteAttachmentPath(webp.logo_path))).toBe(false);
  });

  it("rejects the wrong type, a renamed file, an oversized file, and a non-admin", async () => {
    const services = await import("../src/lib/services");
    const logos = await import("../src/lib/project-logo");
    const admin = await services.setupAdmin("admin", "secret1");
    const adminId = {
      kind: "user" as const,
      userId: admin.id,
      role: "superadmin" as const,
      username: admin.username,
    };
    const user = await services.createUser(adminId, {
      username: "qa",
      password: "secret1",
      role: "user",
    });
    const project = services.createProject(adminId, { name: "EMH" });
    const userId = {
      kind: "user" as const,
      userId: user.id,
      role: "user" as const,
      username: user.username,
    };

    expect(() =>
      logos.setProjectLogo(adminId, project.id, {
        filename: "icon.svg",
        buffer: pngBytes(),
      })
    ).toThrow("不支持的文件类型：.svg");
    expect(() =>
      logos.setProjectLogo(adminId, project.id, {
        filename: "notes.png",
        buffer: Buffer.from("not a png"),
      })
    ).toThrow("文件内容和扩展名不一致");
    expect(() =>
      logos.setProjectLogo(adminId, project.id, {
        filename: "huge.png",
        buffer: pngBytes(LOGO_MAX_BYTES + 1),
      })
    ).toThrow("Logo 不能超过 2MB");
    expect(() =>
      logos.setProjectLogo(userId, project.id, {
        filename: "mark.png",
        buffer: pngBytes(),
      })
    ).toThrow("需要管理员权限");
    expect(services.getProject(adminId, project.id).logo_path).toBe("");
  });

  it("deletes the logo file together with the project", async () => {
    const services = await import("../src/lib/services");
    const logos = await import("../src/lib/project-logo");
    const uploads = await import("../src/lib/uploads");
    const admin = await services.setupAdmin("admin", "secret1");
    const adminId = {
      kind: "user" as const,
      userId: admin.id,
      role: "superadmin" as const,
      username: admin.username,
    };
    const project = services.createProject(adminId, { name: "ZX" });
    logos.setProjectLogo(adminId, project.id, {
      filename: "mark.png",
      buffer: pngBytes(),
    });
    const stored = services.getProject(adminId, project.id);
    const abs = uploads.absoluteAttachmentPath(stored.logo_path);
    services.deleteProject(adminId, project.id);
    expect(fs.existsSync(abs)).toBe(false);
  });
});
