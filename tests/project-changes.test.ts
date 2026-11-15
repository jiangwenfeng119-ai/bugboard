import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Identity } from "../src/lib/types";

const tmpRoot = path.join(os.tmpdir(), `bugboard-changes-test-${process.pid}`);

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

async function setup() {
  const services = await import("../src/lib/services");
  const admin = await services.setupAdmin("admin", "secret1");
  const adminId: Identity = {
    kind: "user",
    userId: admin.id,
    role: "admin",
    username: admin.username,
  };
  const user = await services.createUser(adminId, {
    username: "qa",
    password: "secret1",
    role: "user",
  });
  const outsiderUser = await services.createUser(adminId, {
    username: "outsider",
    password: "secret1",
    role: "user",
  });
  const project = services.createProject(adminId, {
    name: "App A",
    description: "demo",
  });
  services.addMember(adminId, project.id, user.id);
  services.addMember(adminId, project.id, adminId.userId, "admin");
  const qaId: Identity = {
    kind: "user",
    userId: user.id,
    role: "user",
    username: user.username,
  };
  const outsider: Identity = {
    kind: "user",
    userId: outsiderUser.id,
    role: "user",
    username: outsiderUser.username,
  };
  return { services, adminId, qaId, outsider, project };
}

async function readyBug(
  services: Awaited<ReturnType<typeof setup>>["services"],
  qaId: Identity,
  adminId: Identity,
  projectId: number,
  title: string
) {
  const bug = services.createBug(qaId, {
    projectId,
    title,
    priority: "p2",
  });
  services.transitionBug(adminId, bug.id, "start_fix");
  services.transitionBug(adminId, bug.id, "submit_fix", "已修复");
  return bug;
}

describe("project changes ledger", () => {
  it("records changes and markReleased moves every ready bug to awaiting confirm", async () => {
    const { services, adminId, qaId, project } = await setup();
    const changes = await import("../src/lib/project-changes");
    const release = await import("../src/lib/release");

    const first = await readyBug(services, qaId, adminId, project.id, "登录失败");
    const second = await readyBug(services, qaId, adminId, project.id, "列表空白");
    const held = services.createBug(qaId, {
      projectId: project.id,
      title: "还在待处理",
      priority: "p3",
    });

    const fix = changes.recordChange(adminId, project.id, {
      kind: "fix",
      title: "修好登录",
      summary: "缓存键写错",
      commitShas: ["abc1234def"],
      branch: "main",
      bugIds: [first.id],
    });
    const feature = changes.recordChange(adminId, project.id, {
      kind: "feature",
      title: "导出报表",
      commitShas: ["def5678abc"],
    });
    const secondFix = changes.recordChange(adminId, project.id, {
      kind: "fix",
      title: "修好列表",
      commitShas: ["ccc3333"],
      bugIds: [second.id],
    });

    const marked = release.markReleased(adminId, project.id, {
      trigger: "manual",
      headSha: "fff9999aaa",
      detail: "夜间窗口",
    });

    expect(services.getBug(adminId, first.id).status).toBe("awaiting_confirm");
    expect(services.getBug(adminId, second.id).status).toBe("awaiting_confirm");
    expect(services.getBug(adminId, held.id).status).toBe("pending");
    expect(marked.bugIds).toEqual([first.id, second.id]);
    expect(marked.release).toMatchObject({
      kind: "release",
      trigger: "manual",
      result: "success",
      commit_shas: ["fff9999aaa"],
      bug_ids: [first.id, second.id],
      detail: "夜间窗口",
      project_id: project.id,
      actor_type: "user",
      actor_id: adminId.userId,
      release_change_id: null,
    });

    const events = services.getBugEvents(adminId, first.id);
    expect(events.at(-1)).toMatchObject({
      from_status: "ready_to_release",
      to_status: "awaiting_confirm",
      note: "已随发布进入待确认",
    });

    const listed = changes.listChanges(qaId, project.id);
    expect(listed.total).toBe(4);
    expect(listed.changes.map((row) => row.kind)).toEqual([
      "release",
      "fix",
      "feature",
      "fix",
    ]);
    expect(listed.changes[0].id).toBe(marked.release.id);

    const code = changes.listChanges(adminId, project.id, { kind: "code" });
    expect(code.total).toBe(3);
    expect(code.changes.every((row) => row.kind !== "release")).toBe(true);
    expect(code.changes.map((row) => row.id)).toEqual([
      secondFix.change.id,
      feature.change.id,
      fix.change.id,
    ]);

    const fixes = changes.listChanges(adminId, project.id, { kind: "fix", limit: 1 });
    expect(fixes.total).toBe(2);
    expect(fixes.changes).toHaveLength(1);
    expect(fixes.changes[0]).toMatchObject({
      id: secondFix.change.id,
      title: "修好列表",
      commit_shas: ["ccc3333"],
      bug_ids: [second.id],
      release_change_id: marked.release.id,
      trigger: null,
      result: null,
    });
    expect(fix.change).toMatchObject({
      summary: "缓存键写错",
      branch: "main",
      commit_shas: ["abc1234def"],
      bug_ids: [first.id],
    });

    const page = changes.listChanges(adminId, project.id, { limit: 1, offset: 1 });
    expect(page.total).toBe(4);
    expect(page.changes.map((row) => row.id)).toEqual([secondFix.change.id]);

    const reread = changes.listChanges(adminId, project.id, { kind: "feature" });
    expect(reread.changes[0].release_change_id).toBe(marked.release.id);
  });

  it("leaves bug statuses unchanged when the release result is failed", async () => {
    const { services, adminId, qaId, project } = await setup();
    const changes = await import("../src/lib/project-changes");
    const release = await import("../src/lib/release");

    const first = await readyBug(services, qaId, adminId, project.id, "登录失败");
    const second = await readyBug(services, qaId, adminId, project.id, "列表空白");
    const recorded = changes.recordChange(adminId, project.id, {
      kind: "fix",
      title: "修好登录",
      commitShas: ["abc1234"],
      bugIds: [first.id],
    });
    const feature = changes.recordChange(adminId, project.id, {
      kind: "chore",
      title: "整理依赖",
      commitShas: ["bbb2222"],
    });

    const marked = release.markReleased(adminId, project.id, {
      trigger: "scheduled",
      headSha: "bad0001",
      result: "failed",
      detail: "部署脚本退出 1",
    });

    expect(services.getBug(adminId, first.id).status).toBe("ready_to_release");
    expect(services.getBug(adminId, second.id).status).toBe("ready_to_release");
    expect(marked.bugIds).toEqual([first.id, second.id]);
    expect(marked.release).toMatchObject({
      kind: "release",
      trigger: "scheduled",
      result: "failed",
      detail: "部署脚本退出 1",
      commit_shas: ["bad0001"],
      bug_ids: [first.id, second.id],
    });
    expect(
      changes.listChanges(adminId, project.id, { kind: "code" }).changes.map((row) => ({
        id: row.id,
        release_change_id: row.release_change_id,
      }))
    ).toEqual([
      { id: feature.change.id, release_change_id: null },
      { id: recorded.change.id, release_change_id: null },
    ]);

    const recovered = release.markReleased(adminId, project.id, {
      trigger: "manual",
      headSha: "good999",
    });
    expect(services.getBug(adminId, first.id).status).toBe("awaiting_confirm");
    expect(services.getBug(adminId, second.id).status).toBe("awaiting_confirm");
    expect(recovered.release.result).toBe("success");
    expect(
      changes.listChanges(adminId, project.id, { kind: "fix" }).changes[0].release_change_id
    ).toBe(recovered.release.id);
  });

  it("releases only the selected ready bugs and leaves the rest queued", async () => {
    const { services, adminId, qaId, project } = await setup();
    const changes = await import("../src/lib/project-changes");
    const release = await import("../src/lib/release");

    const selected = await readyBug(services, qaId, adminId, project.id, "选中");
    const other = await readyBug(services, qaId, adminId, project.id, "留下");
    const pending = services.createBug(qaId, {
      projectId: project.id,
      title: "未提交修复",
      priority: "p2",
    });
    changes.recordChange(adminId, project.id, {
      kind: "fix",
      title: "选中的修复",
      commitShas: ["aaa1111"],
      bugIds: [selected.id],
    });
    const heldChange = changes.recordChange(adminId, project.id, {
      kind: "fix",
      title: "还没发的修复",
      commitShas: ["bbb2222"],
      bugIds: [other.id],
    });
    const feature = changes.recordChange(adminId, project.id, {
      kind: "feature",
      title: "未挂单的功能",
      commitShas: ["ccc3333"],
    });

    const marked = release.markReleased(adminId, project.id, {
      trigger: "external",
      bugIds: [selected.id],
      headSha: "partial1",
    });

    expect(marked.bugIds).toEqual([selected.id]);
    expect(services.getBug(adminId, selected.id).status).toBe("awaiting_confirm");
    expect(services.getBug(adminId, other.id).status).toBe("ready_to_release");
    expect(services.getBug(adminId, pending.id).status).toBe("pending");
    const rows = changes.listChanges(adminId, project.id, { kind: "code" }).changes;
    const byTitle = Object.fromEntries(rows.map((row) => [row.title, row.release_change_id]));
    expect(byTitle["选中的修复"]).toBe(marked.release.id);
    expect(byTitle["还没发的修复"]).toBeNull();
    expect(byTitle["未挂单的功能"]).toBeNull();
    expect(heldChange.change.release_change_id).toBeNull();
    expect(feature.change.release_change_id).toBeNull();

    expect(() =>
      release.markReleased(adminId, project.id, {
        trigger: "manual",
        bugIds: [other.id, pending.id],
      })
    ).toThrow(/待发布/);
    expect(services.getBug(adminId, other.id).status).toBe("ready_to_release");
    expect(services.getBug(adminId, pending.id).status).toBe("pending");
    expect(changes.listChanges(adminId, project.id, { kind: "release" }).total).toBe(1);
  });

  it("lets members read the ledger and refuses writes from non-admins", async () => {
    const { services, adminId, qaId, outsider, project } = await setup();
    const changes = await import("../src/lib/project-changes");
    const release = await import("../src/lib/release");

    expect(() =>
      changes.recordChange(qaId, project.id, {
        kind: "fix",
        title: "越权",
        commitShas: ["abc"],
      })
    ).toThrow(/需要管理员权限/);
    expect(() =>
      release.markReleased(qaId, project.id, { trigger: "manual" })
    ).toThrow(/需要管理员权限/);
    expect(() => changes.listChanges(outsider, project.id)).toThrow(/无权访问该项目/);

    const recorded = changes.recordChange(adminId, project.id, {
      kind: "chore",
      title: "调整脚本",
      commitShas: ["  abc123  ", ""],
    });
    expect(recorded.change.commit_shas).toEqual(["abc123"]);
    expect(changes.listChanges(qaId, project.id).total).toBe(1);

    expect(() =>
      changes.recordChange(adminId, project.id, {
        kind: "feature",
        title: "  ",
        commitShas: ["abc"],
      })
    ).toThrow(/标题/);
  });
});
