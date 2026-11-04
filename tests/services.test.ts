import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const tmpRoot = path.join(os.tmpdir(), `bugboard-test-${process.pid}`);

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

describe("services integration", () => {
  it("runs setup → project → bug → transition loop", async () => {
    const services = await import("../src/lib/services");
    const admin = await services.setupAdmin("admin", "secret1");
    const adminId = {
      kind: "user" as const,
      userId: admin.id,
      role: "admin" as const,
      username: admin.username,
    };

    const user = await services.createUser(adminId, {
      username: "qa",
      password: "secret1",
      role: "user",
    });
    const project = services.createProject(adminId, {
      name: "App A",
      description: "demo",
    });
    services.addMember(adminId, project.id, user.id);

    const qaId = {
      kind: "user" as const,
      userId: user.id,
      role: "user" as const,
      username: user.username,
    };

    const bug = services.createBug(qaId, {
      projectId: project.id,
      title: "登录失败",
      body: "点登录无响应",
      priority: "p1",
    });
    expect(bug.status).toBe("pending");

    services.transitionBug(adminId, bug.id, "start_fix");
    let current = services.getBug(adminId, bug.id);
    expect(current.status).toBe("fixing");

    services.transitionBug(adminId, bug.id, "submit_fix", "已修复缓存");
    current = services.getBug(adminId, bug.id);
    expect(current.status).toBe("awaiting_confirm");

    services.transitionBug(qaId, bug.id, "confirm_fix");
    current = services.getBug(qaId, bug.id);
    expect(current.status).toBe("confirmed");

    const stats = services.projectStats(adminId, project.id, 7);
    expect(stats.total).toBe(1);
    expect(stats.byStatus.confirmed).toBe(1);
    const today = new Date().toISOString().slice(0, 10);
    const inflowToday = stats.inflow.find((d) => d.day === today);
    expect(inflowToday).toMatchObject({
      fixing: 1,
      awaiting_confirm: 1,
      confirmed: 1,
    });

    const key = services.createApiKey(adminId, {
      name: "agent-qa",
      role: "user",
      projectIds: [project.id],
    });
    expect(key.rawKey.startsWith("bb_")).toBe(true);
  });

  it("lets an admin rename a project and rewrite its description", async () => {
    const services = await import("../src/lib/services");
    const admin = await services.setupAdmin("admin-edit", "secret1");
    const adminId = {
      kind: "user" as const,
      userId: admin.id,
      role: "admin" as const,
      username: admin.username,
    };
    const user = await services.createUser(adminId, {
      username: "member",
      password: "secret1",
      role: "user",
    });
    const project = services.createProject(adminId, {
      name: "旧名称",
      description: "旧说明",
    });
    const member = {
      kind: "user" as const,
      userId: user.id,
      role: "user" as const,
      username: user.username,
    };

    expect(() =>
      services.updateProject(member, project.id, {
        name: "越权",
        description: "不行",
      })
    ).toThrow(/需要管理员/);

    const updated = services.updateProject(adminId, project.id, {
      name: "  新名称  ",
      description: "  新说明  ",
    });
    expect(updated.name).toBe("新名称");
    expect(updated.description).toBe("新说明");
    expect(updated.slug).toBe(project.slug);
    expect(updated.updated_at >= project.updated_at).toBe(true);

    const cleared = services.updateProject(adminId, project.id, {
      name: "新名称",
      description: "   ",
    });
    expect(cleared.description).toBe("");

    expect(() =>
      services.updateProject(adminId, project.id, { name: "  ", description: "x" })
    ).toThrow(/项目名称必填/);
  });

  it("blocks user from accessing unassigned project", async () => {
    const services = await import("../src/lib/services");
    const admin = await services.setupAdmin("admin2", "secret1");
    const adminId = {
      kind: "user" as const,
      userId: admin.id,
      role: "admin" as const,
      username: admin.username,
    };
    const user = await services.createUser(adminId, {
      username: "outsider",
      password: "secret1",
      role: "user",
    });
    const project = services.createProject(adminId, { name: "Secret" });
    const outsider = {
      kind: "user" as const,
      userId: user.id,
      role: "user" as const,
      username: user.username,
    };
    expect(() => services.getProject(outsider, project.id)).toThrow(/无权/);
  });

  it("supports api key edit, disable, regenerate, and delete", async () => {
    const services = await import("../src/lib/services");
    const { resolveApiKeyIdentity } = await import("../src/lib/auth");
    const { getDb } = await import("../src/lib/db");

    const admin = await services.setupAdmin("admin-keys", "secret1");
    const adminId = {
      kind: "user" as const,
      userId: admin.id,
      role: "admin" as const,
      username: admin.username,
    };
    const p1 = services.createProject(adminId, { name: "P1" });
    const p2 = services.createProject(adminId, { name: "P2" });
    const created = services.createApiKey(adminId, {
      name: "agent",
      role: "user",
      projectIds: [p1.id],
    });

    expect(resolveApiKeyIdentity(`Bearer ${created.rawKey}`)?.apiKeyId).toBe(
      created.id
    );

    services.updateApiKey(adminId, created.id, {
      name: "agent-renamed",
      projectIds: [p1.id, p2.id],
    });
    const listed = services.listApiKeys(adminId);
    const row = listed.find((k) => k.id === created.id)!;
    expect(row.name).toBe("agent-renamed");
    const bound = (
      getDb()
        .prepare(
          "SELECT project_id FROM api_key_projects WHERE api_key_id = ? ORDER BY project_id"
        )
        .all(created.id) as { project_id: number }[]
    ).map((r) => r.project_id);
    expect(bound).toEqual([p1.id, p2.id].sort((a, b) => a - b));

    services.updateApiKey(adminId, created.id, { disabled: true });
    expect(resolveApiKeyIdentity(`Bearer ${created.rawKey}`)).toBeNull();
    expect(() =>
      services.updateApiKey(adminId, created.id, { regenerate: true })
    ).toThrow(/禁用/);

    services.updateApiKey(adminId, created.id, { disabled: false });
    const regen = services.updateApiKey(adminId, created.id, {
      regenerate: true,
    });
    expect("rawKey" in regen && regen.rawKey.startsWith("bb_")).toBe(true);
    expect(resolveApiKeyIdentity(`Bearer ${created.rawKey}`)).toBeNull();
    if ("rawKey" in regen) {
      expect(resolveApiKeyIdentity(`Bearer ${regen.rawKey}`)?.name).toBe(
        "agent-renamed"
      );
    }

    services.deleteApiKey(adminId, created.id);
    expect(services.listApiKeys(adminId).find((k) => k.id === created.id)).toBe(
      undefined
    );
    if ("rawKey" in regen) {
      expect(resolveApiKeyIdentity(`Bearer ${regen.rawKey}`)).toBeNull();
    }
  });

  it("supports user edit and delete with safety guards", async () => {
    const services = await import("../src/lib/services");
    const { getDb } = await import("../src/lib/db");

    const admin = await services.setupAdmin("admin-users", "secret1");
    const adminId = {
      kind: "user" as const,
      userId: admin.id,
      role: "superadmin" as const,
      username: admin.username,
    };

    await expect(
      services.updateUser(adminId, admin.id, { role: "user" })
    ).rejects.toThrow(/最后一个超级管理员/);

    const user = await services.createUser(adminId, {
      username: "editable",
      password: "secret1",
      role: "user",
    });

    const updated = await services.updateUser(adminId, user.id, {
      username: "edited",
      role: "admin",
      password: "secret2",
    });
    expect(updated.username).toBe("edited");
    expect(updated.role).toBe("admin");
    await expect(services.login("edited", "secret2")).resolves.toMatchObject({
      username: "edited",
    });

    const demoted = await services.updateUser(adminId, user.id, {
      role: "user",
    });
    expect(demoted.role).toBe("user");

    expect(() => services.deleteUser(adminId, admin.id)).toThrow(
      /不能删除当前登录账号/
    );

    const project = services.createProject(adminId, { name: "Mem" });
    services.addMember(adminId, project.id, user.id);
    // 用管理员身份代建 key，再把 created_by 改成待删用户，验证删用户时清 key
    const key = services.createApiKey(adminId, {
      name: "victim-key",
      role: "user",
      projectIds: [project.id],
    });
    getDb()
      .prepare("UPDATE api_keys SET created_by_user_id = ? WHERE id = ?")
      .run(user.id, key.id);

    services.deleteUser(adminId, user.id);
    expect(services.listUsers(adminId).find((u) => u.id === user.id)).toBe(
      undefined
    );
    expect(
      getDb().prepare("SELECT id FROM api_keys WHERE id = ?").get(key.id)
    ).toBeUndefined();
    expect(
      getDb()
        .prepare(
          "SELECT 1 AS ok FROM project_members WHERE project_id = ? AND user_id = ?"
        )
        .get(project.id, user.id)
    ).toBeUndefined();

    const keyAdmin = services.createApiKey(adminId, {
      name: "admin-key",
      role: "admin",
      projectIds: [],
    });
    const keyIdentity = {
      kind: "api_key" as const,
      apiKeyId: keyAdmin.id,
      role: "admin" as const,
      name: keyAdmin.name,
      projectIds: [] as number[],
    };
    expect(() => services.deleteUser(keyIdentity, admin.id)).toThrow(
      /无权修改超级管理员/
    );
  });

  it("lets only a superadmin delete projects and appoint superadmins", async () => {
    const services = await import("../src/lib/services");
    const { getDb } = await import("../src/lib/db");
    const { uploadsRoot } = await import("../src/lib/paths");

    const owner = await services.setupAdmin("owner", "secret1");
    expect(owner.role).toBe("superadmin");
    const superId = {
      kind: "user" as const,
      userId: owner.id,
      role: "superadmin" as const,
      username: owner.username,
    };
    const staff = await services.createUser(superId, {
      username: "staff",
      password: "secret1",
      role: "admin",
    });
    const adminId = {
      kind: "user" as const,
      userId: staff.id,
      role: "admin" as const,
      username: staff.username,
    };

    await expect(
      services.createUser(adminId, {
        username: "second-owner",
        password: "secret1",
        role: "superadmin",
      })
    ).rejects.toThrow(/无权任命超级管理员/);
    await expect(
      services.updateUser(adminId, owner.id, { role: "admin" })
    ).rejects.toThrow(/无权修改超级管理员/);

    const project = services.createProject(adminId, { name: "待删除" });
    const bug = services.createBug(adminId, {
      projectId: project.id,
      title: "会一起删掉",
    });
    const rel = path.join("bug", String(bug.id), "note.txt");
    fs.mkdirSync(path.dirname(path.join(uploadsRoot(), rel)), {
      recursive: true,
    });
    fs.writeFileSync(path.join(uploadsRoot(), rel), "gone");
    getDb()
      .prepare(
        `INSERT INTO attachments (owner_type, owner_id, filename, mime, size, storage_path, created_at)
         VALUES ('bug', ?, 'note.txt', 'text/plain', 4, ?, ?)`
      )
      .run(bug.id, rel, new Date().toISOString());

    expect(() => services.deleteProject(adminId, project.id)).toThrow(
      /无权删除项目/
    );
    services.deleteProject(superId, project.id);
    expect(
      getDb().prepare("SELECT id FROM projects WHERE id = ?").get(project.id)
    ).toBeUndefined();
    expect(
      getDb().prepare("SELECT id FROM bugs WHERE id = ?").get(bug.id)
    ).toBeUndefined();
    expect(
      getDb().prepare("SELECT id FROM attachments WHERE owner_id = ?").get(bug.id)
    ).toBeUndefined();
    expect(fs.existsSync(path.join(uploadsRoot(), rel))).toBe(false);
    expect(() => services.deleteProject(superId, project.id)).toThrow(
      /项目不存在/
    );

    const kept = services.createProject(adminId, { name: "留下的项目" });
    const doomed = services.createBug(superId, {
      projectId: kept.id,
      title: "单独删掉",
    });
    const event = getDb()
      .prepare("SELECT id FROM bug_status_events WHERE bug_id = ?")
      .get(doomed.id) as { id: number };
    const bugRel = path.join("bug", String(doomed.id), "shot.txt");
    const eventRel = path.join("event", String(event.id), "note.txt");
    for (const rel of [bugRel, eventRel]) {
      fs.mkdirSync(path.dirname(path.join(uploadsRoot(), rel)), {
        recursive: true,
      });
      fs.writeFileSync(path.join(uploadsRoot(), rel), "gone");
    }
    const insertAttachment = getDb().prepare(
      `INSERT INTO attachments (owner_type, owner_id, filename, mime, size, storage_path, created_at)
       VALUES (?, ?, 'note.txt', 'text/plain', 4, ?, ?)`
    );
    const stamp = new Date().toISOString();
    insertAttachment.run("bug", doomed.id, bugRel, stamp);
    insertAttachment.run("status_event", event.id, eventRel, stamp);

    expect(() => services.deleteBug(adminId, doomed.id)).toThrow(/无权删除报障/);
    services.deleteBug(superId, doomed.id);
    expect(
      getDb().prepare("SELECT id FROM bugs WHERE id = ?").get(doomed.id)
    ).toBeUndefined();
    expect(
      getDb()
        .prepare("SELECT id FROM bug_status_events WHERE bug_id = ?")
        .get(doomed.id)
    ).toBeUndefined();
    expect(
      getDb()
        .prepare(
          "SELECT id FROM attachments WHERE owner_id IN (?, ?) AND owner_type IN ('bug', 'status_event')"
        )
        .get(doomed.id, event.id)
    ).toBeUndefined();
    expect(fs.existsSync(path.join(uploadsRoot(), bugRel))).toBe(false);
    expect(fs.existsSync(path.join(uploadsRoot(), eventRel))).toBe(false);
    expect(() => services.deleteBug(superId, doomed.id)).toThrow(/报障不存在/);

    getDb()
      .prepare("UPDATE users SET role = 'admin' WHERE id = ?")
      .run(owner.id);
    await services.updateUser(adminId, staff.id, { role: "user" });
    await expect(
      services.updateUser(adminId, owner.id, { role: "user" })
    ).rejects.toThrow(/最后一个管理员/);
  });

  it("promotes the earliest active admin when no superadmin exists", async () => {
    const Database = (await import("better-sqlite3")).default;
    const { dbPath } = await import("../src/lib/paths");
    fs.mkdirSync(path.dirname(dbPath()), { recursive: true });
    const raw = new Database(dbPath());
    raw.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user','admin')),
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const insert = raw.prepare(
      "INSERT INTO users (username, password_hash, role, active, created_at, updated_at) VALUES (?, 'x', 'admin', ?, 't', 't')"
    );
    insert.run("inactive-first", 0);
    insert.run("earliest-active", 1);
    insert.run("later-active", 1);
    raw.close();

    const { getDb } = await import("../src/lib/db");
    const rows = getDb()
      .prepare("SELECT username, role FROM users ORDER BY id")
      .all() as { username: string; role: string }[];
    expect(rows).toEqual([
      { username: "inactive-first", role: "admin" },
      { username: "earliest-active", role: "superadmin" },
      { username: "later-active", role: "admin" },
    ]);
  });

  it("lets a user change their own password", async () => {
    const services = await import("../src/lib/services");
    const user = await services.setupAdmin("self", "secret1");
    const identity = {
      kind: "user" as const,
      userId: user.id,
      role: "admin" as const,
      username: user.username,
    };

    await expect(
      services.changeOwnPassword(identity, {
        currentPassword: "wrong",
        newPassword: "secret2",
      })
    ).rejects.toThrow(/当前密码不正确/);

    await expect(
      services.changeOwnPassword(identity, {
        currentPassword: "secret1",
        newPassword: "123",
      })
    ).rejects.toThrow(/至少 6 位/);

    await expect(
      services.changeOwnPassword(identity, {
        currentPassword: "secret1",
        newPassword: "secret1",
      })
    ).rejects.toThrow(/不能与当前密码相同/);

    await services.changeOwnPassword(identity, {
      currentPassword: "secret1",
      newPassword: "secret2",
    });
    await expect(services.login("self", "secret1")).rejects.toThrow(/账号或密码错误/);
    await expect(services.login("self", "secret2")).resolves.toMatchObject({
      username: "self",
    });

    const key = services.createApiKey(identity, {
      name: "no-password",
      role: "admin",
      projectIds: [],
    });
    await expect(
      services.changeOwnPassword(
        {
          kind: "api_key",
          apiKeyId: key.id,
          role: "admin",
          name: key.name,
          projectIds: [],
        },
        { currentPassword: "secret2", newPassword: "secret3" }
      )
    ).rejects.toThrow(/无权修改密码/);
  });

  it("lists bugs newest first and sorts each column", async () => {
    const services = await import("../src/lib/services");
    const { getDb } = await import("../src/lib/db");
    const admin = await services.setupAdmin("admin", "secret1");
    const adminId = {
      kind: "user" as const,
      userId: admin.id,
      role: "admin" as const,
      username: admin.username,
    };
    const zhang = await services.createUser(adminId, {
      username: "张三",
      password: "secret1",
      role: "user",
    });
    const li = await services.createUser(adminId, {
      username: "李四",
      password: "secret1",
      role: "user",
    });
    const project = services.createProject(adminId, { name: "Sort", description: "" });
    services.addMember(adminId, project.id, zhang.id);
    services.addMember(adminId, project.id, li.id);
    const zhangId = {
      kind: "user" as const,
      userId: zhang.id,
      role: "user" as const,
      username: zhang.username,
    };
    const liId = {
      kind: "user" as const,
      userId: li.id,
      role: "user" as const,
      username: li.username,
    };

    const older = services.createBug(zhangId, {
      projectId: project.id,
      title: "界面错位",
      priority: "p3",
    });
    const newest = services.createBug(liId, {
      projectId: project.id,
      title: "登录失败",
      priority: "p1",
    });
    const middle = services.createBug(zhangId, {
      projectId: project.id,
      title: "文案错误",
      priority: "p2",
    });
    const db = getDb();
    db.prepare("UPDATE bugs SET updated_at = ? WHERE id = ?").run(
      "2026-11-01T00:00:00.000Z",
      older.id
    );
    db.prepare("UPDATE bugs SET status = 'fixing', updated_at = ? WHERE id = ?").run(
      "2026-11-04T00:00:00.000Z",
      newest.id
    );
    db.prepare("UPDATE bugs SET status = 'confirmed', updated_at = ? WHERE id = ?").run(
      "2026-11-02T00:00:00.000Z",
      middle.id
    );

    const titles = (rows: { title: string }[]) => rows.map((b) => b.title);

    expect(titles(services.listBugs(adminId, project.id))).toEqual([
      "登录失败",
      "文案错误",
      "界面错位",
    ]);
    expect(services.listBugs(adminId, project.id)[0].reporter_label).toBe("李四");
    expect(titles(services.listBugs(adminId, project.id, { sort: "nope" }))).toEqual([
      "登录失败",
      "文案错误",
      "界面错位",
    ]);
    expect(
      titles(services.listBugs(adminId, project.id, { sort: "updated", dir: "asc" }))
    ).toEqual(["界面错位", "文案错误", "登录失败"]);
    expect(
      titles(services.listBugs(adminId, project.id, { sort: "priority", dir: "asc" }))
    ).toEqual(["登录失败", "文案错误", "界面错位"]);
    expect(
      titles(services.listBugs(adminId, project.id, { sort: "title", dir: "asc" }))
    ).toEqual(["文案错误", "界面错位", "登录失败"]);
    expect(
      titles(services.listBugs(adminId, project.id, { sort: "reporter", dir: "asc" }))
    ).toEqual(["界面错位", "文案错误", "登录失败"]);
    expect(
      titles(services.listBugs(adminId, project.id, { sort: "status", dir: "asc" }))
    ).toEqual(["界面错位", "登录失败", "文案错误"]);
  });

  it("aggregates each reporter by project and current outcome", async () => {
    const services = await import("../src/lib/services");
    const { getDb } = await import("../src/lib/db");
    const admin = await services.setupAdmin("admin-stats", "secret1");
    const adminId = {
      kind: "user" as const,
      userId: admin.id,
      role: "admin" as const,
      username: admin.username,
    };
    const qa = await services.createUser(adminId, {
      username: "qa",
      password: "secret1",
      role: "user",
    });
    const quiet = await services.createUser(adminId, {
      username: "quiet",
      password: "secret1",
      role: "user",
    });
    const appA = services.createProject(adminId, { name: "门户", description: "" });
    const appB = services.createProject(adminId, { name: "记账", description: "" });
    const qaId = {
      kind: "user" as const,
      userId: qa.id,
      role: "user" as const,
      username: qa.username,
    };
    services.addMember(adminId, appA.id, qa.id);
    services.addMember(adminId, appB.id, qa.id);

    const confirmed = services.createBug(qaId, {
      projectId: appA.id,
      title: "登录失败",
    });
    services.transitionBug(adminId, confirmed.id, "start_fix");
    services.transitionBug(adminId, confirmed.id, "submit_fix", "已修");
    services.transitionBug(qaId, confirmed.id, "confirm_fix");

    const rejected = services.createBug(qaId, {
      projectId: appA.id,
      title: "不是问题",
    });
    services.transitionBug(adminId, rejected.id, "mark_invalid", "无法复现");

    const fixingThenInvalid = services.createBug(qaId, {
      projectId: appA.id,
      title: "后来不属实",
    });
    services.transitionBug(adminId, fixingThenInvalid.id, "start_fix");
    services.transitionBug(adminId, fixingThenInvalid.id, "mark_invalid", "环境问题");

    const fixing = services.createBug(qaId, {
      projectId: appA.id,
      title: "还在修",
    });
    services.transitionBug(adminId, fixing.id, "start_fix");

    const pending = services.createBug(qaId, {
      projectId: appB.id,
      title: "还没看",
    });

    const old = services.createBug(qaId, {
      projectId: appA.id,
      title: "旧单",
    });
    const oldAt = new Date();
    oldAt.setUTCDate(oldAt.getUTCDate() - 40);
    getDb()
      .prepare("UPDATE bugs SET created_at = ? WHERE id = ?")
      .run(oldAt.toISOString(), old.id);

    const key = services.createApiKey(adminId, {
      name: "agent-qa",
      role: "user",
      projectIds: [appB.id],
    });
    const keyId = {
      kind: "api_key" as const,
      apiKeyId: key.id,
      role: "user" as const,
      name: "agent-qa",
      projectIds: [appB.id],
    };
    const waiting = services.createBug(keyId, {
      projectId: appB.id,
      title: "接口超时",
    });
    services.transitionBug(adminId, waiting.id, "start_fix");
    services.transitionBug(adminId, waiting.id, "submit_fix", "已加重试");

    const member = {
      kind: "user" as const,
      userId: quiet.id,
      role: "user" as const,
      username: quiet.username,
    };
    expect(() => services.reporterAnalytics(member, "all")).toThrow(/需要管理员/);

    const all = services.reporterAnalytics(adminId, "all");
    const qaRow = all.reporters.find((row) => row.reporterId === qa.id && row.reporterType === "user");
    const keyRow = all.reporters.find(
      (row) => row.reporterId === key.id && row.reporterType === "api_key"
    );
    const quietRow = all.reporters.find((row) => row.reporterId === quiet.id);
    expect(qaRow).toMatchObject({
      name: "qa",
      total: 6,
      adopted: 2,
      confirmed: 1,
      invalid: 2,
      fixing: 1,
      pending: 2,
      awaiting_confirm: 0,
    });
    expect(qaRow?.projects.map((project) => [project.projectName, project.total, project.adopted])).toEqual([
      ["门户", 5, 2],
      ["记账", 1, 0],
    ]);
    expect(keyRow).toMatchObject({
      name: "agent-qa",
      total: 1,
      adopted: 1,
      confirmed: 0,
      awaiting_confirm: 1,
    });
    expect(keyRow?.projects).toMatchObject([{ projectName: "记账", total: 1, adopted: 1 }]);
    expect(quietRow).toMatchObject({ total: 0, projects: [] });
    expect(all.totals).toMatchObject({
      total: 7,
      adopted: 3,
      confirmed: 1,
      invalid: 2,
      submitters: 2,
    });
    expect(pending.status).toBe("pending");

    const recent = services.reporterAnalytics(adminId, 30);
    const recentQa = recent.reporters.find((row) => row.reporterId === qa.id);
    expect(recentQa).toMatchObject({ total: 5, pending: 1 });
    expect(recent.totals.total).toBe(6);

    services.deleteUser(adminId, qa.id);
    const afterDelete = services.reporterAnalytics(adminId, "all");
    expect(
      afterDelete.reporters.find((row) => row.reporterType === "user" && row.reporterId === qa.id)
    ).toMatchObject({
      name: `已删除用户 #${qa.id}`,
      presence: "missing",
      total: 6,
      confirmed: 1,
    });
  });
});
