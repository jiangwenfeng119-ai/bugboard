import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const tmpRoot = path.join(os.tmpdir(), `bugboard-followup-${process.pid}`);

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

describe("ledger follow-up", () => {
  it("lists the reporter's in-flight bugs that are not already waiting on them", async () => {
    const services = await import("../src/lib/services");
    const admin = await services.setupAdmin("follow-admin", "secret1");
    const adminId = {
      kind: "user" as const,
      userId: admin.id,
      role: "admin" as const,
      username: admin.username,
    };
    const qa = await services.createUser(adminId, {
      username: "follow-qa",
      password: "secret1",
      role: "user",
    });
    const qaId = {
      kind: "user" as const,
      userId: qa.id,
      role: "user" as const,
      username: qa.username,
    };
    const project = services.createProject(adminId, { name: "跟进", description: "" });
    services.addMember(adminId, project.id, qa.id);
    services.addMember(adminId, project.id, admin.id, "admin");

    const parked = services.createBug(qaId, { projectId: project.id, title: "还在待处理" });
    const fixing = services.createBug(qaId, { projectId: project.id, title: "正在修" });
    services.transitionBug(adminId, fixing.id, "start_fix");
    const releasing = services.createBug(qaId, { projectId: project.id, title: "等发布" });
    services.transitionBug(adminId, releasing.id, "start_fix");
    services.transitionBug(adminId, releasing.id, "submit_fix", "请这样重测");
    const confirming = services.createBug(qaId, { projectId: project.id, title: "等我确认" });
    services.transitionBug(adminId, confirming.id, "start_fix");
    services.transitionBug(adminId, confirming.id, "submit_fix", "已修好");
    services.transitionBug(adminId, confirming.id, "release_fixes");
    const done = services.createBug(qaId, { projectId: project.id, title: "已经结束" });
    services.transitionBug(adminId, done.id, "start_fix");
    services.transitionBug(adminId, done.id, "submit_fix", "好了");
    services.transitionBug(adminId, done.id, "release_fixes");
    services.transitionBug(qaId, done.id, "confirm_fix");

    const mine = services.listMyOpenBugs(qaId);
    expect(mine.groups[0]?.items.map((item) => item.title)).toEqual([
      "还在待处理",
      "正在修",
      "等发布",
    ]);
    expect(mine.groups[0]?.items.map((item) => item.hint)).toEqual([
      "还没人接单",
      "正在修",
      "还没发布",
    ]);
    expect(mine.total).toBe(3);
    expect(services.listInbox(qaId).groups[0]?.items.map((item) => item.title)).toEqual([
      "等我确认",
    ]);
    expect(services.getBug(qaId, parked.id).status).toBe("pending");
  });

  it("puts a needs-product bug on the named person's list without letting them transition it", async () => {
    const services = await import("../src/lib/services");
    const admin = await services.setupAdmin("pm-admin", "secret1");
    const adminId = {
      kind: "user" as const,
      userId: admin.id,
      role: "admin" as const,
      username: admin.username,
    };
    const pm = await services.createUser(adminId, {
      username: "marshal.jiang",
      password: "secret1",
      role: "user",
    });
    const other = await services.createUser(adminId, {
      username: "other.person",
      password: "secret1",
      role: "user",
    });
    const pmId = {
      kind: "user" as const,
      userId: pm.id,
      role: "user" as const,
      username: pm.username,
    };
    const otherId = {
      kind: "user" as const,
      userId: other.id,
      role: "user" as const,
      username: other.username,
    };
    const project = services.createProject(adminId, { name: "产品", description: "" });
    services.updateProject(adminId, project.id, { product_manager: "Marshal Jiang" });
    services.addMember(adminId, project.id, pm.id);
    services.addMember(adminId, project.id, other.id);
    services.addMember(adminId, project.id, admin.id, "admin");
    const bug = services.createBug(otherId, { projectId: project.id, title: "要一个新按钮" });
    services.transitionBug(adminId, bug.id, "request_product", "现在没有这个按钮");

    const inbox = services.listInbox(pmId);
    expect(inbox.groups[0]?.items.map((item) => item.title)).toEqual(["要一个新按钮"]);
    expect(inbox.groups[0]?.items[0]?.hint).toBe("等你看过");
    expect(services.listInbox(otherId).total).toBe(0);
    expect(services.bugActions(pmId, services.getBug(pmId, bug.id))).not.toContain(
      "accept_product"
    );
    expect(services.bugActions(adminId, services.getBug(adminId, bug.id))).toContain(
      "accept_product"
    );
    expect(services.listMyOpenBugs(otherId).groups[0]?.items.map((item) => item.title)).toEqual([
      "要一个新按钮",
    ]);
    expect(services.listMyOpenBugs(pmId).total).toBe(0);
  });

  it("links two bugs in the same project without changing either status", async () => {
    const services = await import("../src/lib/services");
    const admin = await services.setupAdmin("link-admin", "secret1");
    const adminId = {
      kind: "user" as const,
      userId: admin.id,
      role: "admin" as const,
      username: admin.username,
    };
    const qa = await services.createUser(adminId, {
      username: "link-qa",
      password: "secret1",
      role: "user",
    });
    const qaId = {
      kind: "user" as const,
      userId: qa.id,
      role: "user" as const,
      username: qa.username,
    };
    const alpha = services.createProject(adminId, { name: "甲", description: "" });
    const beta = services.createProject(adminId, { name: "乙", description: "" });
    services.addMember(adminId, alpha.id, qa.id);
    const first = services.createBug(qaId, { projectId: alpha.id, title: "先报的" });
    const second = services.createBug(qaId, { projectId: alpha.id, title: "后报的" });
    const elsewhere = services.createBug(adminId, { projectId: beta.id, title: "另一个项目" });

    services.setSeeAlso(qaId, second.id, first.public_id);
    expect(services.getBug(qaId, first.id).status).toBe("pending");
    expect(services.getBug(qaId, second.id).status).toBe("pending");
    expect(services.listSeeAlso(qaId, second.id).map((item) => item.publicId)).toEqual([
      first.public_id,
    ]);
    expect(services.listSeeAlso(qaId, first.id).map((item) => item.publicId)).toEqual([
      second.public_id,
    ]);
    expect(() => services.setSeeAlso(qaId, second.id, second.public_id)).toThrow(/自己/);
    expect(() => services.setSeeAlso(qaId, second.id, elsewhere.public_id)).toThrow(/这个项目/);

    services.clearSeeAlso(qaId, first.id, second.id);
    expect(services.listSeeAlso(qaId, first.id)).toEqual([]);
    expect(services.listSeeAlso(qaId, second.id)).toEqual([]);
  });
});
