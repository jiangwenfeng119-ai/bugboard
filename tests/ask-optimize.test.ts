import { createHmac } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Identity } from "../src/lib/types";

const tmpRoot = path.join(os.tmpdir(), `bugboard-opt-${process.pid}`);
const admin: Identity = { kind: "user", userId: 1, role: "admin", username: "ada" };
const member: Identity = { kind: "user", userId: 2, role: "user", username: "bea" };

beforeEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(tmpRoot, { recursive: true });
  process.env.DATA_DIR = tmpRoot;
  process.env.DB_PATH = path.join(tmpRoot, "db", "test.sqlite");
  process.env.UPLOADS_DIR = path.join(tmpRoot, "uploads");
});

afterEach(async () => {
  const { resetDbForTests } = await import("../src/lib/db");
  const { setOptimizeFetchForTests } = await import("../src/lib/ask-optimize");
  setOptimizeFetchForTests(null);
  resetDbForTests();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function sign(secret: string, body: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

async function seed() {
  const { getDb, resetDbForTests } = await import("../src/lib/db");
  resetDbForTests();
  const db = getDb();
  const now = "2026-11-26T02:00:00.000Z";
  db.prepare(
    `INSERT INTO users (username, password_hash, role, created_at, updated_at)
     VALUES ('ada', 'x', 'admin', ?, ?)`
  ).run(now, now);
  const project = db
    .prepare(
      `INSERT INTO projects (name, slug, code, github_url, default_branch, created_at, updated_at)
       VALUES ('Bugboard', 'bugboard', 'BB', 'https://github.com/acme/bugboard', 'main', ?, ?)`
    )
    .run(now, now);
  const projectId = Number(project.lastInsertRowid);
  db.prepare(
    `INSERT INTO project_dispatch (project_id, webhook_url, webhook_secret, updated_at)
     VALUES (?, 'http://127.0.0.1:3099/wake', 'whsec_test', ?)`
  ).run(projectId, now);
  db.prepare(
    `INSERT INTO ask_runs
       (project_id, actor_type, actor_id, thread_id, question, question_norm, status, judgment, answer, created_at, updated_at)
     VALUES (?, 'user', 1, 'threadask01', ?, ?, 'done', 'file', ?, ?, ?)`
  ).run(projectId, "看看现在系统能做到吗", "看看现在系统能做到吗", "这需要报障。\n判断：建议报障", now, now);
  return projectId;
}

describe("ask optimizations", () => {
  it("wakes the fixer, stores the diff, and can mark a rollback", async () => {
    await seed();
    const { getDb } = await import("../src/lib/db");
    const {
      setOptimizeFetchForTests,
      submitAskOptimization,
      acceptOptimizeCallback,
      requestOptimizeRevert,
      listAskAdminRecords,
    } = await import("../src/lib/ask-optimize");
    const runId = (getDb().prepare("SELECT id FROM ask_runs").get() as { id: number }).id;
    const sent: { event?: string }[] = [];
    setOptimizeFetchForTests(async (_url, init) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response("{}", { status: 202 });
    });
    await expect(submitAskOptimization(member, runId, "http://127.0.0.1:3080/api/ask/optimizations/callback")).rejects.toThrow(
      /管理员/
    );
    const created = await submitAskOptimization(admin, runId, "http://127.0.0.1:3080/api/ask/optimizations/callback");
    expect(created.status).toBe("sent");
    expect(sent[0]?.event).toBe("ask.needs_optimize");
    expect(created.prompt).toContain("先说明这个能力现在实现了还是没有");
    expect(listAskAdminRecords(admin)[0]?.question).toContain("能做到吗");
    const done = JSON.stringify({
      optimizationId: created.id,
      kind: "done",
      diff: "diff --git a/src/lib/ask-core.ts",
      commitSha: "abc1234def",
      detail: "已提交 abc1234",
    });
    expect(acceptOptimizeCallback(done, `sha256=${sign("whsec_test", done)}`)).toMatchObject({ status: "done" });
    const rolling = await requestOptimizeRevert(admin, created.id, "http://127.0.0.1:3080/api/ask/optimizations/callback");
    expect(rolling.status).toBe("reverting");
    expect(sent[1]?.event).toBe("ask.optimize_revert");
    const back = JSON.stringify({
      optimizationId: created.id,
      kind: "reverted",
      revertSha: "fedcba9",
      detail: "已撤回这次提交",
    });
    expect(acceptOptimizeCallback(back, `sha256=${sign("whsec_test", back)}`)).toMatchObject({ status: "reverted" });
    expect(() => acceptOptimizeCallback(done, "sha256=nope")).toThrow(/签名不对/);
  });

  it("submits every unfinished answer in one pass and skips ones already optimized", async () => {
    const projectId = await seed();
    const { getDb } = await import("../src/lib/db");
    const { setOptimizeFetchForTests, submitAskOptimization, submitOpenAskOptimizations, acceptOptimizeCallback } =
      await import("../src/lib/ask-optimize");
    const db = getDb();
    const now = "2026-11-26T02:00:00.000Z";
    const first = (db.prepare("SELECT id FROM ask_runs").get() as { id: number }).id;
    db.prepare(
      `INSERT INTO ask_runs
         (project_id, actor_type, actor_id, thread_id, question, question_norm, status, judgment, answer, created_at, updated_at)
       VALUES (?, 'user', 1, 'threadask02', '乙要不要报障', '乙要不要报障', 'done', 'exists', '现在可以。判断：已经有了', ?, ?)`
    ).run(projectId, now, now);
    db.prepare(
      `INSERT INTO ask_runs
         (project_id, actor_type, actor_id, thread_id, question, question_norm, status, judgment, answer, created_at, updated_at)
       VALUES (?, 'user', 1, 'threadask03', '丙还在问', '丙还在问', 'streaming', '', '', ?, ?)`
    ).run(projectId, now, now);
    const sent: { prompt?: string }[] = [];
    setOptimizeFetchForTests(async (_url, init) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response("{}", { status: 202 });
    });
    const firstOpt = await submitAskOptimization(admin, first, "http://127.0.0.1:3080/api/ask/optimizations/callback");
    const done = JSON.stringify({
      optimizationId: firstOpt.id,
      kind: "done",
      diff: "",
      detail: "不用改",
    });
    acceptOptimizeCallback(done, `sha256=${sign("whsec_test", done)}`);
    const batch = await submitOpenAskOptimizations(admin, "http://127.0.0.1:3080/api/ask/optimizations/callback");
    expect(batch.status).toBe("sent");
    expect(batch.prompt).toContain("乙要不要报障");
    expect(batch.prompt).toContain("逐条检查");
    expect(batch.prompt).not.toContain("看看现在系统能做到吗");
    expect(batch.prompt).not.toContain("丙还在问");
    expect(sent.at(-1)?.prompt).toContain("乙要不要报障");
    await expect(
      submitOpenAskOptimizations(admin, "http://127.0.0.1:3080/api/ask/optimizations/callback")
    ).rejects.toThrow(/进行中/);
  });
});
