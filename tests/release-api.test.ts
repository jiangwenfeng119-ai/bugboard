import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Identity } from "../src/lib/types";

const tmpRoot = path.join(os.tmpdir(), `bugboard-release-api-${process.pid}`);

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
  const project = services.createProject(adminId, { name: "App A", description: "demo" });
  services.addMember(adminId, project.id, user.id);
  services.addMember(adminId, project.id, admin.id, "admin");
  const qaId: Identity = {
    kind: "user",
    userId: user.id,
    role: "user",
    username: user.username,
  };
  const adminKey = services.createApiKey(adminId, { name: "fixer", role: "admin" });
  const userKey = services.createApiKey(adminId, {
    name: "qa",
    role: "user",
    projectIds: [project.id],
  });
  return { services, adminId, qaId, project, adminKey: adminKey.rawKey, userKey: userKey.rawKey };
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

function request(method: string, url: string, key: string | null, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: {
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("changes and release routes", () => {
  it("records and lists changes, and markReleased moves ready bugs", async () => {
    const { services, adminId, qaId, project, adminKey, userKey } = await setup();
    const bug = await readyBug(services, qaId, adminId, project.id, "按钮没反应");
    const { GET, POST } = await import("../src/app/api/projects/[id]/changes/route");
    const ctx = { params: Promise.resolve({ id: String(project.id) }) };

    const denied = await POST(
      request("POST", `http://test/api/projects/${project.id}/changes`, userKey, {
        kind: "fix",
        title: "修好按钮",
        commitShas: ["abc1234"],
        bugIds: [bug.id],
      }),
      ctx
    );
    expect(denied.status).toBe(403);

    const created = await POST(
      request("POST", `http://test/api/projects/${project.id}/changes`, adminKey, {
        kind: "fix",
        title: "修好按钮",
        commitShas: ["abc1234"],
        bugIds: [bug.id],
      }),
      ctx
    );
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.change.kind).toBe("fix");
    expect(createdBody.change.commit_shas).toEqual(["abc1234"]);

    const listed = await GET(
      request("GET", `http://test/api/projects/${project.id}/changes?kind=fix`, userKey),
      ctx
    );
    expect(listed.status).toBe(200);
    const listedBody = await listed.json();
    expect(listedBody.total).toBe(1);
    expect(listedBody.changes[0].title).toBe("修好按钮");

    const releaseRoute = await import("../src/app/api/projects/[id]/release/route");
    const marked = await releaseRoute.POST(
      request("POST", `http://test/api/projects/${project.id}/release`, adminKey, {
        mode: "mark",
        trigger: "external",
        headSha: "abc1234def",
        bugIds: [bug.id],
      }),
      ctx
    );
    expect(marked.status).toBe(200);
    const markedBody = await marked.json();
    expect(markedBody.release.kind).toBe("release");
    expect(markedBody.bugIds).toEqual([bug.id]);
    expect(services.getBug(adminId, bug.id).status).toBe("awaiting_confirm");
  });

  it("queues a run release without moving bugs", async () => {
    const { services, adminId, qaId, project, adminKey, userKey } = await setup();
    const bug = await readyBug(services, qaId, adminId, project.id, "列表空白");
    const { getDb } = await import("../src/lib/db");
    const { POST, GET } = await import("../src/app/api/projects/[id]/release/route");
    const ctx = { params: Promise.resolve({ id: String(project.id) }) };

    const forbidden = await POST(
      request("POST", `http://test/api/projects/${project.id}/release`, userKey, {
        mode: "run",
        trigger: "manual",
      }),
      ctx
    );
    expect(forbidden.status).toBe(403);

    const queued = await POST(
      request("POST", `http://test/api/projects/${project.id}/release`, adminKey, {
        mode: "run",
        trigger: "manual",
        bugIds: [bug.id],
        detail: "紧急",
      }),
      ctx
    );
    expect(queued.status).toBe(200);
    const body = await queued.json();
    expect(body.queued).toBe(true);
    expect(body.dispatchId).toEqual(expect.any(Number));
    expect(services.getBug(adminId, bug.id).status).toBe("ready_to_release");

    const row = getDb()
      .prepare("SELECT reason, target, status, detail FROM agent_dispatches WHERE id = ?")
      .get(body.dispatchId) as { reason: string; target: string; status: string; detail: string };
    expect(row.reason).toBe("release");
    expect(row.target).toBe("release_runner");
    expect(row.status).toBe("queued");
    expect(JSON.parse(row.detail).bugIds).toEqual([bug.id]);

    const second = await POST(
      request("POST", `http://test/api/projects/${project.id}/release`, adminKey, {
        mode: "run",
        trigger: "manual",
        bugIds: [bug.id],
      }),
      ctx
    );
    expect(second.status).toBe(400);
    expect(((await second.json()) as { error: string }).error).toMatch(/排队或执行/);

    getDb()
      .prepare("UPDATE agent_dispatches SET created_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 180_000).toISOString(), body.dispatchId);
    const dispatch = await import("../src/lib/dispatch");
    const listed = dispatch
      .getDispatchSettings(adminId, project.id)
      .recent.find((item) => item.id === body.dispatchId);
    expect(listed).toMatchObject({ target: "release_runner", status: "queued", reason: "release" });

    const pending = await GET(
      request("GET", `http://test/api/projects/${project.id}/release`, adminKey),
      ctx
    );
    expect(pending.status).toBe(200);
    const pendingBody = await pending.json();
    expect(pendingBody.bugs.map((item: { id: number }) => item.id)).toEqual([bug.id]);

    const member = await GET(
      request("GET", `http://test/api/projects/${project.id}/release`, userKey),
      ctx
    );
    expect(member.status).toBe(403);
  });
});
