import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { glossaryTerms } from "../src/lib/glossary";
import { parseBugEvidence } from "../src/lib/evidence";
import { straightenStroke, type Stroke } from "../src/lib/strokes";
import { polishUtterance, splitTranscript } from "../src/lib/transcript";

const tmpRoot = path.join(os.tmpdir(), `bugboard-capture-${process.pid}`);

beforeEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(tmpRoot, { recursive: true });
  process.env.DATA_DIR = tmpRoot;
  process.env.DB_PATH = path.join(tmpRoot, "db", "test.sqlite");
  process.env.UPLOADS_DIR = path.join(tmpRoot, "uploads");
  delete process.env.ASR_BASE_URL;
  delete process.env.ASR_API_KEY;
});

afterEach(async () => {
  const { resetDbForTests } = await import("../src/lib/db");
  resetDbForTests();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe("capture wording", () => {
  it("removes fillers and keeps a line that is only fillers", () => {
    expect(polishUtterance("嗯登录失败")).toBe("登录失败。");
    expect(polishUtterance("嗯嗯嗯啊啊啊")).toBe("嗯嗯嗯啊啊啊");
  });

  it("splits a pause, drops a bare retraction, and replaces a correction", () => {
    const split = splitTranscript([
      { start: 0, end: 1.2, text: "优惠券没减" },
      { start: 1.5, end: 2.4, text: "总价还是一百二" },
      { start: 8, end: 9, text: "国家选了加拿大总价变了" },
    ]);
    expect(split).toHaveLength(2);
    expect(split[0].quote).toContain("优惠券没减");
    expect(split[0].quote).toContain("总价还是一百二");
    expect(split[1].quote).toContain("加拿大");

    expect(
      splitTranscript([
        { start: 0, end: 1, text: "登录按钮没反应" },
        { start: 2, end: 2.4, text: "不对" },
      ])
    ).toEqual([]);

    const replaced = splitTranscript([
      { start: 0, end: 1, text: "颜色不对" },
      { start: 1.4, end: 2.5, text: "不对，是按钮位置" },
    ]);
    expect(replaced).toHaveLength(1);
    expect(replaced[0].quote).toContain("按钮位置");
    expect(replaced[0].quote).not.toContain("颜色");
  });

  it("marks a short fragment and keeps a snap note with the spoken line", () => {
    const low = splitTranscript([{ start: 0, end: 0.4, text: "啊看一下" }]);
    expect(low[0].confidence).toBe("low");
    expect(low[0].question).toMatch(/确认/);

    const framed = splitTranscript(
      [{ start: 0, end: 2, text: "总价没减优惠券" }],
      [{ index: 0, t: 1, note: "这里挡住了" }]
    );
    expect(framed[0].quote).toContain("这里挡住了");
    expect(framed[0].body).toContain("总价没减优惠券");
    expect(framed[0].evidenceSec).toBe(0);
    expect(framed[0].frameIndex).toBe(0);

    const [only] = splitTranscript([{ start: 0, end: 3, text: "先打开购物车然后点结算" }]);
    expect(only.steps).toEqual(["先打开购物车", "点结算"]);

    const extra = splitTranscript(
      [{ start: 0, end: 1, text: "登录没反应" }],
      [{ index: 0, t: 20, note: "页脚重叠" }]
    );
    expect(extra).toHaveLength(2);
    expect(extra[1].quote).toContain("页脚重叠");
    expect(extra[1].evidenceSec).toBe(20);
  });

  it("straightens a rough box or circle and leaves a stroke", () => {
    expect(straightenStroke(boxStroke()).tool).toBe("rect");
    expect(straightenStroke(ellipseStroke()).tool).toBe("ellipse");
    expect(straightenStroke(scribble()).tool).toBe("free");
  });

  it("collects project names for recognition", () => {
    const terms = glossaryTerms({
      name: "Atlas Web",
      tech_stack: "Next.js、Go",
      product_manager: "林可",
      description: "",
      experience_officer: "",
      agent_notes: "",
    });
    expect(terms).toContain("Atlas Web");
    expect(terms).toContain("Next.js");
    expect(terms).toContain("林可");
  });

  it("rejects a stroke that leaves the picture", () => {
    expect(() =>
      parseBugEvidence({ strokes: [{ tool: "rect", points: [{ x: 2, y: 0 }, { x: 0, y: 1 }] }] })
    ).toThrow(/圈选坐标无效/);
    expect(parseBugEvidence({ quote: "没反应", steps: ["打开", "点击"] }).steps).toEqual([
      "打开",
      "点击",
    ]);
  });
});

describe("capture sessions", () => {
  it("keeps reviewed drafts as bugs and claims only the uploader's file", async () => {
    const services = await import("../src/lib/services");
    const captures = await import("../src/lib/captures");
    const staged = await import("../src/lib/staged");
    const widget = await import("../src/lib/widget");
    const speech = await import("../src/lib/transcribe");

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
    const project = services.createProject(adminId, { name: "Atlas Web", description: "结账" });
    services.addMember(adminId, project.id, user.id);
    const qa = {
      kind: "user" as const,
      userId: user.id,
      role: "user" as const,
      username: user.username,
    };

    const session = captures.createCaptureSession(qa, project.id, {
      transcript: [
        { start: 0, end: 1.2, text: "优惠券没减" },
        { start: 8, end: 9, text: "国家选了加拿大" },
      ],
      frames: [
        {
          t: 0.4,
          note: "",
          filename: "圈选.png",
          mime: "image/png",
          buffer: Buffer.from("png"),
          strokes: [{ tool: "rect", points: [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.4 }] }],
        },
      ],
    });
    expect(session.drafts.length).toBeGreaterThanOrEqual(2);
    const marked = session.drafts.find((draft) => draft.frameUrl);
    expect(marked?.strokes).toHaveLength(1);

    const updates = session.drafts.map((draft, index) => ({
      id: draft.id,
      title: draft.title,
      body: draft.body,
      quote: draft.quote,
      steps: draft.steps,
      question: draft.question,
      status: index === 0 ? ("kept" as const) : ("discarded" as const),
    }));
    const committed = await captures.commitCaptureSession(qa, session.id, updates);
    expect(committed.bugs).toHaveLength(1);
    expect(committed.bugs[0].quote).toContain("优惠券");
    expect(services.getAttachments("bug", committed.bugs[0].id)).toHaveLength(1);
    expect(committed.session.status).toBe("done");
    await expect(captures.commitCaptureSession(qa, session.id)).rejects.toThrow(/已经整理完/);

    const silent = captures.createCaptureSession(qa, project.id, {
      transcript: [],
      durationSec: 12,
      video: { filename: "走查.webm", mime: "video/webm", buffer: Buffer.from("webm") },
    });
    expect(silent.drafts).toHaveLength(1);
    expect(silent.title).toBe("这段走查");
    expect(silent.drafts[0].confidence).toBe("low");
    expect(silent.drafts[0].question).toMatch(/没有识别到话/);
    expect(silent.videoUrl).toBeTruthy();

    const retracted = captures.createCaptureSession(qa, project.id, {
      transcript: [{ start: 0, end: 1, text: "不对" }],
      video: { filename: "走查.webm", mime: "video/webm", buffer: Buffer.from("webm2") },
    });
    expect(retracted.drafts).toHaveLength(1);
    expect(() =>
      captures.createCaptureSession(qa, project.id, {
        transcript: [{ start: 0, end: 1, text: "不对" }],
      })
    ).toThrow(/没有整理出草稿/);

    const mine = staged.stageUpload(qa, project.id, {
      filename: "证据.png",
      buffer: Buffer.from("mine"),
    });
    const theirs = staged.stageUpload(adminId, project.id, {
      filename: "别人.png",
      buffer: Buffer.from("theirs"),
    });
    const filed = services.createBug(qa, {
      projectId: project.id,
      title: "按钮没反应",
      evidence: { attachmentIds: [mine.id], quote: "点了没反应" },
    });
    expect(services.getAttachments("bug", filed.id)[0].filename).toBe("证据.png");
    expect(filed.quote).toBe("点了没反应");
    expect(() =>
      services.createBug(qa, {
        projectId: project.id,
        title: "不能拿别人的图",
        evidence: { attachmentIds: [theirs.id] },
      })
    ).toThrow(/无权使用该附件/);

    const token = widget.ensureWidgetToken(adminId, project.id);
    const reported = widget.createWidgetReport(token.token, {
      ip: "10.0.0.8",
      note: "总价没变",
      pageUrl: "https://shop.example/cart",
      viewport: "1440x900",
      userAgent: "TestBrowser",
      consoleText: "error: cart failed",
      file: { filename: "圈选.png", mime: "image/png", buffer: Buffer.from("widget") },
    });
    expect(reported.reporter_id).toBe(admin.id);
    expect(reported.source_url).toBe("https://shop.example/cart");
    expect(reported.body).toContain("cart failed");
    expect(services.getAttachments("bug", reported.id)).toHaveLength(1);

    await expect(speech.transcribeSpeech({ filename: "a.webm", mime: "audio/webm", buffer: Buffer.from("a") }, "")).resolves.toEqual({
      available: false,
    });
    process.env.ASR_BASE_URL = "https://asr.example/v1";
    process.env.ASR_API_KEY = "test-key";
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ text: "登录失败", segments: [{ start: 0, end: 1.2, text: "登录失败" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const heard = await speech.transcribeSpeech(
      { filename: "a.webm", mime: "audio/webm", buffer: Buffer.from("a") },
      "专有名词：Atlas"
    );
    expect(heard).toMatchObject({ available: true, text: "登录失败" });
  });
});

function boxStroke(): Stroke {
  const points = [];
  const edge = (x1: number, y1: number, x2: number, y2: number) => {
    for (let step = 0; step <= 8; step += 1) {
      const t = step / 8;
      points.push({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t });
    }
  };
  edge(0.2, 0.2, 0.8, 0.2);
  edge(0.8, 0.2, 0.8, 0.7);
  edge(0.8, 0.7, 0.2, 0.7);
  edge(0.2, 0.7, 0.2, 0.2);
  return { tool: "free", points };
}

function ellipseStroke(): Stroke {
  const points = [];
  for (let step = 0; step <= 24; step += 1) {
    const angle = (Math.PI * 2 * step) / 24;
    points.push({ x: 0.5 + Math.cos(angle) * 0.28, y: 0.5 + Math.sin(angle) * 0.18 });
  }
  return { tool: "free", points };
}

function scribble(): Stroke {
  return {
    tool: "free",
    points: [
      { x: 0.1, y: 0.8 },
      { x: 0.2, y: 0.7 },
      { x: 0.35, y: 0.55 },
      { x: 0.5, y: 0.4 },
      { x: 0.62, y: 0.28 },
      { x: 0.74, y: 0.18 },
      { x: 0.86, y: 0.1 },
      { x: 0.9, y: 0.08 },
    ],
  };
}
