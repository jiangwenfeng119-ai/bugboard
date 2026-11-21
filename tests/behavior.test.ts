import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Identity } from "../src/lib/types";

const tmpRoot = path.join(os.tmpdir(), `bugboard-behavior-${process.pid}`);

beforeEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(tmpRoot, { recursive: true });
  process.env.DATA_DIR = tmpRoot;
  process.env.DB_PATH = path.join(tmpRoot, "db", "test.sqlite");
  process.env.UPLOADS_DIR = path.join(tmpRoot, "uploads");
  delete process.env.CURSOR_API_KEY;
  delete process.env.BUGBOARD_DISPATCH_API_KEY;
  delete process.env.BASE_URL;
});

afterEach(async () => {
  const { resetDbForTests } = await import("../src/lib/db");
  const { setDispatchTransportForTests } = await import("../src/lib/dispatch");
  setDispatchTransportForTests(null);
  resetDbForTests();
  delete process.env.CURSOR_API_KEY;
  delete process.env.BUGBOARD_DISPATCH_API_KEY;
  delete process.env.BASE_URL;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

async function setup() {
  const services = await import("../src/lib/services");
  const dispatch = await import("../src/lib/dispatch");
  const behavior = await import("../src/lib/behavior");
  const release = await import("../src/lib/release");
  const admin = await services.setupAdmin("admin", "secret1");
  const identity: Identity = {
    kind: "user",
    userId: admin.id,
    role: "superadmin",
    username: admin.username,
  };
  const project = services.createProject(identity, { name: "柜台", description: "", code: "SOC" });
  services.addMember(identity, project.id, identity.userId, "admin");
  return { services, dispatch, behavior, release, identity, project };
}

describe("project behavior", () => {
  it("lists only projects that already have a saved row, and adds them after save", async () => {
    const { services, behavior, identity, project } = await setup();
    expect(behavior.listBehaviorOverviews(identity)).toEqual([]);
    const other = services.createProject(identity, { name: "仓库", description: "", code: "WARE" });
    services.addMember(identity, other.id, identity.userId, "admin");
    const current = behavior.getBehaviorSettings(identity, project.id);
    behavior.saveBehaviorSettings(identity, project.id, { ...current, wakeOnApiCreate: true });
    const listed = behavior.listBehaviorOverviews(identity);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      projectId: project.id,
      projectName: "柜台",
    });
    expect(listed[0].summary.join("\n")).toContain("API Key 建单会叫醒");
    expect(listed[0].highlights.find((item) => item.label === "建单叫醒")?.value).toContain("API Key");
    expect(listed[0].highlights.every((item) => item.value.length < 80)).toBe(true);
    expect(listed.map((item: { projectId: number }) => item.projectId)).not.toContain(other.id);
  });

  it("keeps today's behavior until an admin saves a change", async () => {
    const { behavior, identity, project } = await setup();
    const settings = behavior.getBehaviorSettings(identity, project.id);
    expect(settings).toMatchObject({
      wakeOnWebCreate: true,
      wakeOnWidgetCreate: true,
      wakeOnCaptureCreate: true,
      wakeOnApiCreate: false,
      wakeDrainQueue: true,
      intakePriority: "p2",
      inboxShowPending: true,
      inboxShowReady: true,
      inboxPendingCap: 8,
      releaseAdvancesBugs: true,
      releaseTimeoutMin: 45,
      captureGapMs: 1200,
      captureShortChars: 8,
      organizeTimeoutMin: 8,
    });
    expect(settings.wakeActions).toEqual([
      "provide_info",
      "reject_fix",
      "release_return",
      "dispute_invalid",
      "reopen_invalid",
      "supplement",
      "accept_product",
    ]);
    expect(behavior.describeBehavior(settings).join("\n")).toContain("网页建单会叫醒");
    expect(behavior.describeBehavior(settings).join("\n")).toContain("API Key 建单不叫醒");
  });

  it("saves behavior without wiping the wake address", async () => {
    const { behavior, dispatch, identity, project } = await setup();
    dispatch.saveDispatchSettings(identity, project.id, {
      webhookUrl: "http://127.0.0.1:3099/wake",
      cursorEnabled: false,
    });
    const current = behavior.getBehaviorSettings(identity, project.id);
    behavior.saveBehaviorSettings(identity, project.id, { ...current, wakeOnWebCreate: false });
    expect(dispatch.getDispatchSettings(identity, project.id).webhookUrl).toBe(
      "http://127.0.0.1:3099/wake"
    );
    expect(behavior.getBehaviorSettings(identity, project.id).wakeOnWebCreate).toBe(false);
    expect(() =>
      behavior.saveBehaviorSettings(identity, project.id, { ...current, inboxPendingCap: 0 })
    ).toThrow(/1 到 30/);
  });

  it("wakes only the sources that are turned on", async () => {
    const { services, dispatch, behavior, identity, project } = await setup();
    const calls: string[] = [];
    dispatch.setDispatchTransportForTests(async (input) => {
      calls.push(input.body);
      return { status: 204, text: "" };
    });
    dispatch.saveDispatchSettings(identity, project.id, {
      webhookUrl: "http://127.0.0.1:3099/wake",
      cursorEnabled: false,
    });
    const current = behavior.getBehaviorSettings(identity, project.id);
    behavior.saveBehaviorSettings(identity, project.id, {
      ...current,
      wakeOnWebCreate: false,
      wakeOnWidgetCreate: true,
      wakeOnCaptureCreate: false,
      wakeOnApiCreate: true,
    });

    services.createBug(identity, { projectId: project.id, title: "网页" });
    services.createBug(identity, { projectId: project.id, title: "小组件", wakeSource: "widget" });
    services.createBug(identity, { projectId: project.id, title: "走查", wakeSource: "capture" });
    const key = services.createApiKey(identity, { name: "qa", role: "user", projectIds: [project.id] });
    services.createBug(
      { kind: "api_key", apiKeyId: key.id, role: "user", name: "qa", projectIds: [project.id] },
      { projectId: project.id, title: "接口" }
    );
    await dispatch.flushDispatches();
    const reasons = calls.map((body) => JSON.parse(body).bug.title as string);
    expect(reasons).toEqual(["小组件", "接口"]);
  });

  it("does not wake when an API key accepts product work", async () => {
    const { services, dispatch, identity, project } = await setup();
    const calls: string[] = [];
    dispatch.setDispatchTransportForTests(async (input) => {
      calls.push(input.body);
      return { status: 204, text: "" };
    });
    dispatch.saveDispatchSettings(identity, project.id, {
      webhookUrl: "http://127.0.0.1:3099/wake",
      cursorEnabled: false,
    });
    const bug = services.createBug(identity, { projectId: project.id, title: "要加税率" });
    await dispatch.flushDispatches();
    services.transitionBug(identity, bug.id, "request_product", "现在没有这个税率");
    const key = services.createApiKey(identity, { name: "fixer", role: "admin" });
    const fixer: Identity = {
      kind: "api_key",
      apiKeyId: key.id,
      role: "admin",
      name: "fixer",
      projectIds: [],
    };
    const before = calls.length;
    services.transitionBug(fixer, bug.id, "accept_product");
    await dispatch.flushDispatches();
    expect(services.getBug(identity, bug.id).status).toBe("fixing");
    expect(calls).toHaveLength(before);
  });

  it("names only the current bug when the queue drain is off", async () => {
    const { services, dispatch, behavior, identity, project } = await setup();
    const calls: string[] = [];
    dispatch.setDispatchTransportForTests(async (input) => {
      calls.push(input.body);
      return { status: 204, text: "" };
    });
    dispatch.saveDispatchSettings(identity, project.id, {
      webhookUrl: "http://127.0.0.1:3099/wake",
      cursorEnabled: false,
    });
    const current = behavior.getBehaviorSettings(identity, project.id);
    behavior.saveBehaviorSettings(identity, project.id, { ...current, wakeDrainQueue: false });
    services.createBug(identity, { projectId: project.id, title: "只处理这一张" });
    await dispatch.flushDispatches();
    const prompt = JSON.parse(calls[0] || "{}").prompt as string;
    expect(prompt).toContain("这一轮只处理这一张，不要继续该项目其余待处理。");
    expect(prompt).not.toContain("处理完这张后，继续该项目其余待处理。");
  });

  it("hides ready-to-release from the admin inbox when that queue is off", async () => {
    const { services, behavior, identity, project } = await setup();
    const bug = services.createBug(identity, { projectId: project.id, title: "等发布" });
    services.transitionBug(identity, bug.id, "start_fix");
    services.transitionBug(identity, bug.id, "submit_fix", "已修好");
    expect(services.listInbox(identity).groups[0]?.items.map((item) => item.title)).toContain("等发布");
    const current = behavior.getBehaviorSettings(identity, project.id);
    behavior.saveBehaviorSettings(identity, project.id, { ...current, inboxShowReady: false, inboxPendingCap: 1 });
    for (let i = 0; i < 3; i += 1) {
      services.createBug(identity, { projectId: project.id, title: `待处理 ${i}` });
    }
    const inbox = services.listInbox(identity);
    expect(inbox.groups[0]?.items.map((item) => item.title)).not.toContain("等发布");
    expect(inbox.groups[0]?.items.filter((item) => item.status === "pending")).toHaveLength(1);
    expect(inbox.groups[0]?.pendingOverflow).toBe(2);
  });

  it("leaves ready bugs in place when release does not advance them", async () => {
    const { services, behavior, release, identity, project } = await setup();
    const bug = services.createBug(identity, { projectId: project.id, title: "等发布" });
    services.transitionBug(identity, bug.id, "start_fix");
    services.transitionBug(identity, bug.id, "submit_fix", "已修好");
    const current = behavior.getBehaviorSettings(identity, project.id);
    behavior.saveBehaviorSettings(identity, project.id, { ...current, releaseAdvancesBugs: false });
    release.markReleased(identity, project.id, { trigger: "manual", detail: "只记账" });
    expect(services.getBug(identity, bug.id).status).toBe("ready_to_release");
  });

  it("uses the project release timeout", async () => {
    const { services, dispatch, behavior, release, identity, project } = await setup();
    const bug = services.createBug(identity, { projectId: project.id, title: "等发布" });
    services.transitionBug(identity, bug.id, "start_fix");
    services.transitionBug(identity, bug.id, "submit_fix", "已修好");
    dispatch.saveDispatchSettings(identity, project.id, {
      webhookUrl: "",
      cursorEnabled: false,
      organizeEnabled: false,
      repairLocalEnabled: false,
      deployMode: "restart",
      deployCommand: "/usr/local/bin/counter-deploy",
      releaseSchedule: "22:00",
    });
    const current = behavior.getBehaviorSettings(identity, project.id);
    behavior.saveBehaviorSettings(identity, project.id, { ...current, releaseTimeoutMin: 10 });
    const first = release.enqueueScheduledReleases(identity, "22:00");
    const job = release.claimQueuedRelease(identity, "SOC");
    const { getDb } = await import("../src/lib/db");
    getDb()
      .prepare("UPDATE agent_dispatches SET claimed_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 11 * 60 * 1000).toISOString(), job!.dispatchId);
    const again = release.enqueueScheduledReleases(identity, "22:00");
    expect(again.map((item) => item.projectId)).toEqual([project.id]);
    expect(first[0]?.dispatchId).toBe(job?.dispatchId);
  });

  it("splits a walkthrough on the configured pause and marks short lines", async () => {
    const { splitTranscript } = await import("../src/lib/transcript");
    const wide = splitTranscript(
      [
        { start: 0, end: 1, text: "登录按钮没反应" },
        { start: 3, end: 4, text: "刷新之后还是这样" },
      ],
      [],
      { gapSec: 5, shortChars: 8 }
    );
    expect(wide).toHaveLength(1);
    const tight = splitTranscript(
      [
        { start: 0, end: 1, text: "登录按钮没反应" },
        { start: 3, end: 4, text: "刷新之后还是这样" },
      ],
      [],
      { gapSec: 1.2 }
    );
    expect(tight).toHaveLength(2);
    const short = splitTranscript([{ start: 0, end: 1, text: "按钮坏了呀" }], [], { shortChars: 20 });
    expect(short[0]?.confidence).toBe("low");
  });

  it("uses the intake priority for widget reports", async () => {
    const { services, behavior, identity, project } = await setup();
    const widget = await import("../src/lib/widget");
    const current = behavior.getBehaviorSettings(identity, project.id);
    behavior.saveBehaviorSettings(identity, project.id, { ...current, intakePriority: "p3" });
    const token = widget.ensureWidgetToken(identity, project.id).token;
    const bug = widget.createWidgetReport(token, { ip: "127.0.0.1", note: "按钮没反应" });
    expect(bug.priority).toBe("p3");
    const web = services.createBug(identity, { projectId: project.id, title: "手选", priority: "p1" });
    expect(web.priority).toBe("p1");
  });

  it("gives up on a stalled organize after the project timeout", async () => {
    const { behavior, identity, project } = await setup();
    const captures = await import("../src/lib/captures");
    const current = behavior.getBehaviorSettings(identity, project.id);
    behavior.saveBehaviorSettings(identity, project.id, { ...current, organizeTimeoutMin: 1 });
    const session = captures.createCaptureSession(identity, project.id, {
      transcript: [{ start: 0, end: 1, text: "登录按钮没反应" }],
    });
    const { getDb, nowIso } = await import("../src/lib/db");
    getDb()
      .prepare(
        "UPDATE capture_sessions SET organize_status = 'organizing', organize_started_at = ? WHERE id = ?"
      )
      .run(new Date(Date.now() - 2 * 60 * 1000).toISOString(), session.id);
    expect(nowIso()).toBeTruthy();
    const settled = captures.getCaptureSession(identity, session.id);
    expect(settled.organizeStatus).toBe("failed");
    expect(settled.organizeDetail).toContain("整理超时");
  });

  it("adds release_return only to saved wake lists that still include reject_fix", async () => {
    const { behavior, dispatch, identity, project } = await setup();
    const { storedWakeActionsWithReleaseReturn } = await import("../src/lib/behavior-shared");
    expect(storedWakeActionsWithReleaseReturn("")).toBe("");
    expect(storedWakeActionsWithReleaseReturn("supplement")).toBe("supplement");
    expect(storedWakeActionsWithReleaseReturn("reject_fix,supplement")).toBe(
      "reject_fix,supplement,release_return"
    );

    dispatch.saveDispatchSettings(identity, project.id, {
      webhookUrl: "http://127.0.0.1:3099/wake",
      cursorEnabled: false,
    });
    const { getDb, resetDbForTests } = await import("../src/lib/db");
    getDb()
      .prepare("UPDATE project_dispatch SET wake_actions = ? WHERE project_id = ?")
      .run("provide_info,reject_fix,supplement", project.id);
    resetDbForTests();
    const reopened = await import("../src/lib/behavior");
    const migrated = reopened.getBehaviorSettings(identity, project.id).wakeActions;
    expect(migrated).toContain("reject_fix");
    expect(migrated).toContain("release_return");

    getDb()
      .prepare("UPDATE project_dispatch SET wake_actions = '' WHERE project_id = ?")
      .run(project.id);
    resetDbForTests();
    expect(reopened.getBehaviorSettings(identity, project.id).wakeActions).toEqual([]);
  });
});
