import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Identity } from "../src/lib/types";

const tmpRoot = path.join(os.tmpdir(), `bugboard-release-config-${process.pid}`);

beforeEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(tmpRoot, { recursive: true });
  process.env.DATA_DIR = tmpRoot;
  process.env.DB_PATH = path.join(tmpRoot, "db", "test.sqlite");
  process.env.UPLOADS_DIR = path.join(tmpRoot, "uploads");
});

afterEach(async () => {
  const { resetDbForTests } = await import("../src/lib/db");
  const { setDispatchTransportForTests } = await import("../src/lib/dispatch");
  setDispatchTransportForTests(null);
  resetDbForTests();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

async function setup() {
  const services = await import("../src/lib/services");
  const dispatch = await import("../src/lib/dispatch");
  const release = await import("../src/lib/release");
  const admin = await services.setupAdmin("admin", "secret1");
  const adminId: Identity = {
    kind: "user",
    userId: admin.id,
    role: "superadmin",
    username: admin.username,
  };
  const project = services.createProject(adminId, {
    name: "柜台",
    description: "",
    code: "SOC",
    slug: "counter",
  });
  services.addMember(adminId, project.id, admin.id, "admin");
  services.updateProject(adminId, project.id, {
    github_url: "https://github.com/acme/counter",
    default_branch: "main",
  });
  const qa = await services.createUser(adminId, { username: "qa", password: "secret1", role: "user" });
  services.addMember(adminId, project.id, qa.id);
  const qaId: Identity = { kind: "user", userId: qa.id, role: "user", username: qa.username };
  const adminKey = services.createApiKey(adminId, { name: "release", role: "admin" });
  const userKey = services.createApiKey(adminId, { name: "qa", role: "user", projectIds: [project.id] });
  return { services, dispatch, release, adminId, qaId, project, adminKey: adminKey.rawKey, userKey: userKey.rawKey };
}

async function readyBug(
  services: Awaited<ReturnType<typeof setup>>["services"],
  qaId: Identity,
  adminId: Identity,
  projectId: number,
  title: string
) {
  const bug = services.createBug(qaId, { projectId, title, priority: "p2" });
  services.transitionBug(adminId, bug.id, "start_fix");
  services.transitionBug(adminId, bug.id, "submit_fix", "已修复");
  return bug;
}

function request(method: string, url: string, key: string, body: unknown) {
  return new NextRequest(url, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("release deploy config", () => {
  it("stores deploy mode, command, and schedule without a wake job", async () => {
    const { dispatch, adminId, project } = await setup();
    const saved = dispatch.saveDispatchSettings(adminId, project.id, {
      webhookUrl: "",
      cursorEnabled: false,
      organizeEnabled: false,
      repairLocalEnabled: false,
      deployMode: "restart",
      deployCommand: "/usr/local/bin/counter-deploy",
      releaseSchedule: "22:00",
    });
    expect(saved.deployMode).toBe("restart");
    expect(saved.deployCommand).toBe("/usr/local/bin/counter-deploy");
    expect(saved.releaseSchedule).toBe("22:00");

    dispatch.saveDispatchSettings(adminId, project.id, {
      webhookUrl: "",
      cursorEnabled: false,
      organizeEnabled: false,
      repairLocalEnabled: false,
      deployMode: "restart",
      deployCommand: "/usr/local/bin/counter-deploy",
      releaseSchedule: "22:00",
    });
    const again = dispatch.saveDispatchSettings(adminId, project.id, {
      webhookUrl: "http://127.0.0.1:3099/wake",
      cursorEnabled: false,
    });
    expect(again.deployMode).toBe("restart");
    expect(again.deployCommand).toBe("/usr/local/bin/counter-deploy");
    expect(again.releaseSchedule).toBe("22:00");

    const listed = dispatch.listDispatchOverviews(adminId);
    expect(listed.map((item) => item.projectId)).toEqual([project.id]);
    expect(listed[0]).toMatchObject({ deployMode: "restart", releaseSchedule: "22:00" });
  });

  it("rejects a bad schedule and a deploy mode with no command", async () => {
    const { dispatch, adminId, project } = await setup();
    expect(() =>
      dispatch.saveDispatchSettings(adminId, project.id, {
        webhookUrl: "",
        cursorEnabled: false,
        organizeEnabled: false,
        repairLocalEnabled: false,
        deployMode: "restart",
        deployCommand: "",
        releaseSchedule: "22:00",
      })
    ).toThrow(/发布命令/);
    expect(() =>
      dispatch.saveDispatchSettings(adminId, project.id, {
        webhookUrl: "",
        cursorEnabled: false,
        organizeEnabled: false,
        repairLocalEnabled: false,
        deployMode: "none",
        deployCommand: "",
        releaseSchedule: "10pm",
      })
    ).toThrow(/定时/);
  });

  it("rejects shell pipelines for the deploy command", async () => {
    const { dispatch, adminId, project, adminKey } = await setup();
    for (const deployCommand of ["bash -c 'echo hi'", "foo && bar"]) {
      expect(() =>
        dispatch.saveDispatchSettings(adminId, project.id, {
          webhookUrl: "",
          cursorEnabled: false,
          organizeEnabled: false,
          repairLocalEnabled: false,
          deployMode: "restart",
          deployCommand,
          releaseSchedule: "",
        })
      ).toThrow(/发布命令/);
    }
    const { PUT } = await import("../src/app/api/projects/[id]/dispatch/route");
    const ctx = { params: Promise.resolve({ id: String(project.id) }) };
    const denied = await PUT(
      request("PUT", `http://test/api/projects/${project.id}/dispatch`, adminKey, {
        webhookUrl: "",
        cursorEnabled: false,
        deployMode: "restart",
        deployCommand: "foo && bar",
        releaseSchedule: "",
      }),
      ctx
    );
    expect(denied.status).toBe(400);
    const body = (await denied.json()) as { error: string };
    expect(body.error).toMatch(/发布命令/);
  });
});

describe("release runner queue", () => {
  it("pokes the wake webhook and leaves the dispatch queued", async () => {
    const { dispatch, release, adminId, project } = await setup();
    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    dispatch.setDispatchTransportForTests(async (input) => {
      calls.push(input);
      return { status: 202, text: JSON.stringify({ spawned: true }) };
    });
    const saved = dispatch.saveDispatchSettings(adminId, project.id, {
      webhookUrl: "http://127.0.0.1:3099/wake",
      cursorEnabled: false,
      deployMode: "restart",
      deployCommand: "/usr/local/bin/counter-deploy",
      releaseSchedule: "22:00",
    });
    const queued = release.requestRunRelease(adminId, project.id, {
      trigger: "manual",
      bugIds: [],
      detail: "紧急",
    });
    await dispatch.flushDispatches();
    expect(calls).toHaveLength(1);
    const payload = JSON.parse(calls[0].body) as { event: string; dispatchId: number; project: { code: string } };
    expect(payload.event).toBe("release.queued");
    expect(payload.dispatchId).toBe(queued.dispatchId);
    expect(payload.project.code).toBe("SOC");
    expect(calls[0].headers["X-Bugboard-Signature"]).toBe(
      `sha256=${dispatch.signDispatchBody(saved.webhookSecret, calls[0].body)}`
    );
    const { getDb } = await import("../src/lib/db");
    const row = getDb()
      .prepare("SELECT status, target FROM agent_dispatches WHERE id = ?")
      .get(queued.dispatchId) as { status: string; target: string };
    expect(row).toEqual({ status: "queued", target: "release_runner" });
  });

  it("enqueues only the projects due at that minute, then claims and finishes them", async () => {
    const { services, dispatch, release, adminId, qaId, project } = await setup();
    const later = services.createProject(adminId, { name: "库房", description: "", code: "WH", slug: "warehouse" });
    const idle = services.createProject(adminId, { name: "门店", description: "", code: "SHOP", slug: "shop" });
    services.addMember(adminId, later.id, adminId.userId, "admin");
    services.addMember(adminId, idle.id, adminId.userId, "admin");
    const releaseOnly = {
      webhookUrl: "",
      cursorEnabled: false,
      organizeEnabled: false,
      repairLocalEnabled: false,
    };
    dispatch.saveDispatchSettings(adminId, project.id, {
      ...releaseOnly,
      deployMode: "restart",
      deployCommand: "/usr/local/bin/counter-deploy",
      releaseSchedule: "22:00",
    });
    dispatch.saveDispatchSettings(adminId, later.id, {
      ...releaseOnly,
      deployMode: "ecs_deploy",
      deployCommand: "/opt/acme/ecs-deploy",
      releaseSchedule: "23:00",
    });
    dispatch.saveDispatchSettings(adminId, idle.id, {
      ...releaseOnly,
      deployMode: "none",
      deployCommand: "",
      releaseSchedule: "22:00",
    });
    const bug = await readyBug(services, qaId, adminId, project.id, "按钮没反应");

    const queued = release.enqueueScheduledReleases(adminId, "22:00");
    expect(queued.map((item) => item.projectId)).toEqual([project.id]);
    expect(release.enqueueScheduledReleases(adminId, "22:00")).toEqual([]);

    const job = release.claimQueuedRelease(adminId, "counter");
    expect(job).toMatchObject({
      projectId: project.id,
      code: "SOC",
      slug: "counter",
      githubUrl: "https://github.com/acme/counter",
      defaultBranch: "main",
      deployMode: "restart",
      deployCommand: "/usr/local/bin/counter-deploy",
      trigger: "scheduled",
      bugIds: null,
    });
    expect(release.claimQueuedRelease(adminId)).toBeNull();

    const done = release.finishRunningRelease(adminId, {
      dispatchId: job!.dispatchId,
      result: "success",
      headSha: "abc1234def",
    });
    expect(done.bugIds).toEqual([bug.id]);
    expect(services.getBug(adminId, bug.id).status).toBe("awaiting_confirm");
    const { getDb } = await import("../src/lib/db");
    const row = getDb()
      .prepare("SELECT status FROM agent_dispatches WHERE id = ?")
      .get(job!.dispatchId) as { status: string };
    expect(row.status).toBe("sent");
  });

  it("records a failed finish without moving bugs", async () => {
    const { services, dispatch, release, adminId, qaId, project } = await setup();
    dispatch.saveDispatchSettings(adminId, project.id, {
      webhookUrl: "",
      cursorEnabled: false,
      organizeEnabled: false,
      repairLocalEnabled: false,
      deployMode: "restart",
      deployCommand: "/usr/local/bin/counter-deploy",
      releaseSchedule: "",
    });
    const bug = await readyBug(services, qaId, adminId, project.id, "列表空白");
    release.requestRunRelease(adminId, project.id, { trigger: "manual", bugIds: [bug.id] });
    const job = release.claimQueuedRelease(adminId, "SOC");
    const failed = release.finishRunningRelease(adminId, {
      dispatchId: job!.dispatchId,
      result: "failed",
      detail: "工作区有未提交改动",
    });
    expect(failed.release.result).toBe("failed");
    expect(services.getBug(adminId, bug.id).status).toBe("ready_to_release");
    const { getDb } = await import("../src/lib/db");
    const row = getDb()
      .prepare("SELECT status, detail FROM agent_dispatches WHERE id = ?")
      .get(job!.dispatchId) as { status: string; detail: string };
    expect(row.status).toBe("failed");
    expect(row.detail).toContain("未提交");
  });

  it("fails a running claim after 45 minutes so the next night can queue", async () => {
    const { dispatch, release, adminId, project } = await setup();
    dispatch.saveDispatchSettings(adminId, project.id, {
      webhookUrl: "",
      cursorEnabled: false,
      organizeEnabled: false,
      repairLocalEnabled: false,
      deployMode: "restart",
      deployCommand: "/usr/local/bin/counter-deploy",
      releaseSchedule: "22:00",
    });
    const first = release.enqueueScheduledReleases(adminId, "22:00");
    const job = release.claimQueuedRelease(adminId, "SOC");
    expect(job?.dispatchId).toBe(first[0].dispatchId);
    const { getDb } = await import("../src/lib/db");
    getDb()
      .prepare("UPDATE agent_dispatches SET claimed_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 20 * 60 * 1000).toISOString(), job!.dispatchId);
    expect(release.enqueueScheduledReleases(adminId, "22:00")).toEqual([]);

    getDb()
      .prepare("UPDATE agent_dispatches SET claimed_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 46 * 60 * 1000).toISOString(), job!.dispatchId);
    const again = release.enqueueScheduledReleases(adminId, "22:00");
    expect(again.map((item) => item.projectId)).toEqual([project.id]);
    const stale = getDb()
      .prepare("SELECT status, detail FROM agent_dispatches WHERE id = ?")
      .get(job!.dispatchId) as { status: string; detail: string };
    expect(stale.status).toBe("failed");
    expect(stale.detail).toContain("超时");
  });

  it("claims through the runner route for an admin key only", async () => {
    const { release, adminId, project, adminKey, userKey } = await setup();
    release.requestRunRelease(adminId, project.id, { trigger: "manual" });
    const { POST } = await import("../src/app/api/releases/runner/route");
    const denied = await POST(
      request("POST", "http://test/api/releases/runner", userKey, { op: "claim" })
    );
    expect(denied.status).toBe(403);
    const claimed = await POST(
      request("POST", "http://test/api/releases/runner", adminKey, { op: "claim", project: "SOC" })
    );
    expect(claimed.status).toBe(200);
    const body = await claimed.json();
    expect(body.job.projectId).toBe(project.id);
    expect(body.job.code).toBe("SOC");
  });
});
