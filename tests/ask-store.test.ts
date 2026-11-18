import { createHmac } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Identity } from "../src/lib/types";

const tmpRoot = path.join(os.tmpdir(), `bugboard-ask-${process.pid}`);

beforeEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(tmpRoot, { recursive: true });
  process.env.DATA_DIR = tmpRoot;
  process.env.DB_PATH = path.join(tmpRoot, "db", "test.sqlite");
  process.env.UPLOADS_DIR = path.join(tmpRoot, "uploads");
});

afterEach(async () => {
  const { resetDbForTests } = await import("../src/lib/db");
  const { setAskFetchForTests } = await import("../src/lib/ask-store");
  setAskFetchForTests(null);
  resetDbForTests();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const admin: Identity = { kind: "user", userId: 1, role: "admin", username: "ada" };

function sign(secret: string, body: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

async function seed() {
  const { getDb, resetDbForTests } = await import("../src/lib/db");
  resetDbForTests();
  const db = getDb();
  const now = "2026-11-17T10:00:00.000Z";
  db.prepare(
    `INSERT INTO users (username, password_hash, role, created_at, updated_at)
     VALUES ('ada', 'x', 'admin', ?, ?)`
  ).run(now, now);
  const project = db
    .prepare(
      `INSERT INTO projects (name, slug, code, github_url, default_branch, tech_stack, agent_notes, created_at, updated_at)
       VALUES ('EMH', 'emh', 'EMH', 'https://github.com/acme/emh', 'release/1.0', 'Next.js', '不要写密码', ?, ?)`
    )
    .run(now, now);
  db.prepare(
    `INSERT INTO project_dispatch (project_id, webhook_url, webhook_secret, updated_at)
     VALUES (?, 'http://127.0.0.1:3099/wake', 'whsec_test', ?)`
  ).run(project.lastInsertRowid, now);
  return Number(project.lastInsertRowid);
}

describe("ask store", () => {
  it("refuses a project without a repository and an offline wake host", async () => {
    const projectId = await seed();
    const { getDb } = await import("../src/lib/db");
    const { startAsk } = await import("../src/lib/ask-store");
    getDb().prepare("UPDATE projects SET github_url = '' WHERE id = ?").run(projectId);
    const missing = await startAsk(admin, projectId, { question: "有这个功能吗", threadId: "threadask01" }, "http://127.0.0.1:3080/api/ask/callback");
    expect(missing.status).toBe("failed");
    expect(missing.error).toMatch(/没有代码仓/);

    getDb().prepare("UPDATE projects SET github_url = 'https://github.com/acme/emh' WHERE id = ?").run(projectId);
    getDb().prepare("UPDATE project_dispatch SET webhook_url = '' WHERE project_id = ?").run(projectId);
    const offline = await startAsk(admin, projectId, { question: "入口在哪", threadId: "threadask01" }, "http://127.0.0.1:3080/api/ask/callback");
    expect(offline.error).toMatch(/代码机暂时不在/);
  });

  it("keeps the previous answer when the commit is unchanged, and clears a reverted stream", async () => {
    const projectId = await seed();
    const { setAskFetchForTests, startAsk, acceptAskCallback, readAsk, stopAsk } = await import("../src/lib/ask-store");
    setAskFetchForTests(async () => new Response("{}", { status: 202 }));
    const first = await startAsk(
      admin,
      projectId,
      { question: "积分入口在哪", threadId: "threadask01" },
      "http://127.0.0.1:3080/api/ask/callback"
    );
    expect(first.status).toBe("streaming");

    const probe = JSON.stringify({ runId: first.id, seq: 1, kind: "probe", mirrorSha: "abc1234" });
    expect(acceptAskCallback(probe, sign("whsec_test", probe))).toEqual({ skip: false });
    const done = JSON.stringify({
      runId: first.id,
      seq: 2,
      kind: "done",
      mirrorSha: "abc1234",
      sessionId: "sess_1",
      text: "入口在 src/points.tsx\n判断：已经有了",
    });
    acceptAskCallback(done, sign("whsec_test", done));
    expect(readAsk(admin, projectId, first.id).judgment).toBe("exists");

    const second = await startAsk(
      admin,
      projectId,
      { question: "积分入口在哪", threadId: "threadask01" },
      "http://127.0.0.1:3080/api/ask/callback"
    );
    const again = JSON.stringify({ runId: second.id, seq: 1, kind: "probe", mirrorSha: "abc1234" });
    expect(acceptAskCallback(again, sign("whsec_test", again))).toEqual({ skip: true });
    const cached = readAsk(admin, projectId, second.id);
    expect(cached.cached).toBe(true);
    expect(cached.answer).toContain("src/points.tsx");

    const third = await startAsk(
      admin,
      projectId,
      { question: "另一个问题", threadId: "threadask02" },
      "http://127.0.0.1:3080/api/ask/callback"
    );
    const delta = JSON.stringify({ runId: third.id, seq: 2, kind: "delta", text: "半截回答" });
    acceptAskCallback(delta, sign("whsec_test", delta));
    const reverted = JSON.stringify({
      runId: third.id,
      seq: 3,
      kind: "reverted",
      text: "这次没有回答。代码没有被改动。",
    });
    acceptAskCallback(reverted, sign("whsec_test", reverted));
    const cleared = readAsk(admin, projectId, third.id);
    expect(cleared.status).toBe("reverted");
    expect(cleared.answer).toBe("");

    const fourth = await startAsk(
      admin,
      projectId,
      { question: "再问一次", threadId: "threadask03" },
      "http://127.0.0.1:3080/api/ask/callback"
    );
    expect(stopAsk(admin, projectId, fourth.id).error).toBe("已停止");
    const late = JSON.stringify({ runId: fourth.id, seq: 9, kind: "done", text: "不该留下\n判断：已经有了" });
    acceptAskCallback(late, sign("whsec_test", late));
    expect(readAsk(admin, projectId, fourth.id).status).toBe("failed");
    expect(() => acceptAskCallback(late, "sha256=nope")).toThrow(/签名不对/);
  });

  it("puts open bugs and uploaded docs in the prompt, and still forbids edits", async () => {
    const projectId = await seed();
    const { getDb } = await import("../src/lib/db");
    const { setAskFetchForTests, startAsk } = await import("../src/lib/ask-store");
    const now = "2026-11-17T10:00:00.000Z";
    getDb()
      .prepare(
        `INSERT INTO bugs (project_id, public_id, title, body, priority, status, reporter_type, reporter_id, created_at, updated_at)
         VALUES (?, 'EMH261117001', '积分页打不开', '', 'p2', 'pending', 'user', 1, ?, ?)`
      )
      .run(projectId, now, now);
    fs.mkdirSync(process.env.UPLOADS_DIR!, { recursive: true });
    fs.writeFileSync(path.join(process.env.UPLOADS_DIR!, "notes.md"), "积分入口在个人中心。");
    getDb()
      .prepare(
        `INSERT INTO project_documents (project_id, kind, filename, mime, size, storage_path, created_at)
         VALUES (?, 'docs', 'notes.md', 'text/markdown', 12, 'notes.md', ?)`
      )
      .run(projectId, now);
    let prompt = "";
    setAskFetchForTests(async (_url, init) => {
      prompt = JSON.parse(String(init?.body)).prompt as string;
      return new Response("{}", { status: 202 });
    });
    const run = await startAsk(admin, projectId, { question: "积分入口在哪", threadId: "threadask09" }, "http://127.0.0.1:3080/api/ask/callback");
    expect(run.statusLine).toBe("已交给代码机");
    expect(prompt).toContain("EMH261117001");
    expect(prompt).toContain("积分入口在个人中心");
    expect(prompt).toContain("不能修改文件");
    expect(prompt).toContain("不能改这些单");
  });

  it("stops the hour when the limit is one, and refuses a closed project", async () => {
    const projectId = await seed();
    const { getDb } = await import("../src/lib/db");
    const { setAskFetchForTests, startAsk } = await import("../src/lib/ask-store");
    setAskFetchForTests(async () => new Response("{}", { status: 202 }));
    getDb().prepare("UPDATE project_dispatch SET ask_per_hour = 1 WHERE project_id = ?").run(projectId);
    await startAsk(admin, projectId, { question: "第一问", threadId: "threadask11" }, "http://127.0.0.1:3080/api/ask/callback");
    await expect(
      startAsk(admin, projectId, { question: "第二问", threadId: "threadask12" }, "http://127.0.0.1:3080/api/ask/callback")
    ).rejects.toThrow(/这个小时的提问已经用完/);
    getDb().prepare("UPDATE project_dispatch SET ask_enabled = 0 WHERE project_id = ?").run(projectId);
    await expect(
      startAsk(admin, projectId, { question: "第三问", threadId: "threadask13" }, "http://127.0.0.1:3080/api/ask/callback")
    ).rejects.toThrow(/还没打开问答/);
  });

  it("keeps a question when the code machine is down and hands it back once", async () => {
    const projectId = await seed();
    const { getDb } = await import("../src/lib/db");
    const { setAskFetchForTests, startAsk, claimQueuedAsks } = await import("../src/lib/ask-store");
    setAskFetchForTests(async () => {
      throw new Error("connect ECONNREFUSED");
    });
    const run = await startAsk(
      admin,
      projectId,
      { question: "入口在哪", threadId: "threadask21" },
      "http://127.0.0.1:3080/api/ask/callback"
    );
    expect(run.status).toBe("streaming");
    expect(run.statusLine).toMatch(/已留下/);
    const queued = getDb().prepare("SELECT queued FROM ask_runs WHERE id = ?").get(run.id) as { queued: number };
    expect(queued.queued).toBe(1);
    const jobs = claimQueuedAsks() as { event: string; prompt: string }[];
    expect(jobs).toHaveLength(1);
    expect(jobs[0].event).toBe("project.ask");
    expect(jobs[0].prompt).toContain("入口在哪");
    expect(claimQueuedAsks()).toEqual([]);
  });

  it("saves a feature map and groups answers that say the feature is missing", async () => {
    const projectId = await seed();
    const { setAskFetchForTests, startFeatureMap, acceptAskCallback, readFeatureMap, startAsk, listAskGaps } =
      await import("../src/lib/ask-store");
    let prompt = "";
    setAskFetchForTests(async (_url, init) => {
      prompt = JSON.parse(String(init?.body)).prompt as string;
      return new Response("{}", { status: 202 });
    });
    const map = await startFeatureMap(admin, projectId, "http://127.0.0.1:3080/api/ask/callback");
    const done = JSON.stringify({
      runId: map.id,
      seq: 1,
      kind: "done",
      mirrorSha: "def5678",
      text: "登录：/login，src/app/login/page.tsx\n判断：已经有了",
    });
    acceptAskCallback(done, sign("whsec_test", done));
    expect(readFeatureMap(admin, projectId)?.body).toContain("src/app/login/page.tsx");
    expect(readFeatureMap(admin, projectId)?.body).not.toContain("判断：");

    const asked = await startAsk(
      admin,
      projectId,
      { question: "有导出工资条吗", threadId: "threadask31" },
      "http://127.0.0.1:3080/api/ask/callback"
    );
    expect(prompt).toContain("src/app/login/page.tsx");
    expect(prompt).toContain("不要再搜索仓库");
    const gap = JSON.stringify({
      runId: asked.id,
      seq: 1,
      kind: "done",
      mirrorSha: "def5678",
      text: "默认分支里没有这个入口\n判断：建议报障",
    });
    acceptAskCallback(gap, sign("whsec_test", gap));
    const gaps = listAskGaps(admin, projectId);
    expect(gaps[0]).toMatchObject({ question: "有导出工资条吗", count: 1 });
  });
});
