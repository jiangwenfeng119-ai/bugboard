import fs from "fs";
import os from "os";
import path from "path";
import { gzipSync } from "zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { draftAskAnswer, featureMapFromPrompt } from "../scripts/ask-protocol.mjs";
import {
  codeFilesFromQuery,
  graphifyBuildArgs,
  planCodeGraph,
  queryText,
  refreshCodeGraph,
} from "../scripts/code-graph.mjs";
import { reportExcerpt } from "../src/lib/code-graph-text";

const tmpRoot = path.join(os.tmpdir(), `bugboard-graph-${process.pid}`);

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

describe("code graph", () => {
  it("rebuilds only when the commit changes and keeps the old graph if it shrinks", () => {
    expect(planCodeGraph({ sha: "abc1234", builtSha: "", hasGraph: false })).toBe("extract");
    expect(planCodeGraph({ sha: "abc1234", builtSha: "abc1234", hasGraph: true })).toBe("skip");
    expect(planCodeGraph({ sha: "def5678", builtSha: "abc1234", hasGraph: true })).toBe("update");
    const mirror = path.join(tmpRoot, "mirror");
    const askRoot = path.join(tmpRoot, "asks");
    fs.mkdirSync(mirror, { recursive: true });
    const reports = [
      "## Summary\n- 100 nodes · 200 edges · 3 communities\n\n## God Nodes\n1. `getDb()` - 4 edges\n",
      "## Summary\n- 10 nodes · 12 edges · 1 communities\n",
    ];
    let step = 0;
    const calls: string[][] = [];
    const spawn = (_bin: string, args: string[]) => {
      calls.push(args);
      if (args[0] === "extract") {
        const out = path.join(args[args.indexOf("--out") + 1], "graphify-out");
        fs.mkdirSync(out, { recursive: true });
        fs.writeFileSync(path.join(out, "GRAPH_REPORT.md"), reports[Math.min(step, reports.length - 1)]);
        fs.writeFileSync(path.join(out, "graph.json"), "{}");
        step += 1;
      }
      return { code: 0, stdout: "", stderr: "" };
    };
    const first = refreshCodeGraph(
      { askRoot, code: "BUGBOARD", mirrorDir: mirror, sha: "abc1234abc" },
      spawn
    );
    expect(first.action).toBe("extract");
    expect(first.nodes).toBe(100);
    expect(calls.map((args) => args[0])).toEqual(["extract", "cluster-only"]);
    const again = refreshCodeGraph(
      { askRoot, code: "BUGBOARD", mirrorDir: mirror, sha: "abc1234abc" },
      spawn
    );
    expect(again.action).toBe("skip");
    const shrunk = refreshCodeGraph(
      { askRoot, code: "BUGBOARD", mirrorDir: mirror, sha: "def5678def" },
      spawn
    );
    expect(shrunk.error).toMatch(/已保留旧图/);
    expect(shrunk.nodes).toBe(100);
    expect(fs.readFileSync(path.join(askRoot, "graphs", "BUGBOARD", "built-sha"), "utf8")).toBe("abc1234abc");
  });

  it("turns a graph query into file paths and a short excerpt", () => {
    expect(queryText("submit_fix 在哪个文件")).toContain("submit_fix");
    expect(graphifyBuildArgs("/mirrors/BUGBOARD", "/graphs/BUGBOARD")[0]).toContain("--code-only");
    const files = codeFilesFromQuery(
      "NODE ask() [src=src/app/projects/[id]/bugs/AskBeforeReport.tsx loc=L194 community=Community 27]"
    );
    expect(files).toEqual(["src/app/projects/[id]/bugs/AskBeforeReport.tsx"]);
    const excerpt = reportExcerpt(
      "## Summary\n- 10 nodes · 20 edges · 2 communities\n\n## God Nodes\n1. `getDb()` - 4 edges\n\n## Communities\nskip\n"
    );
    expect(excerpt).toContain("getDb()");
    expect(excerpt).not.toContain("skip");
    const prompt = [
      "功能地图在这个项目的「汇总」页最下面。地图如下：",
      "- **会员积分**（`/points`）",
      "代码图谱在这个项目的「汇总」页，功能地图下面。摘录如下：",
      "getDb()",
      "用户的问题在下面",
    ].join("\n");
    expect(featureMapFromPrompt(prompt)).toContain("会员积分");
    expect(featureMapFromPrompt(prompt)).not.toContain("getDb()");
    const answer = draftAskAnswer({
      question: "submit_fix 在哪个文件",
      documents: "",
      hits: [],
      graphFiles: files,
    });
    expect(answer).toContain("src/app/projects/[id]/bugs/AskBeforeReport.tsx");
    expect(answer).toContain("判断：已经有了");
    expect(answer).not.toContain("标题：");
  });

  it("stores the report for the summary page and keeps html for admins", async () => {
    const { getDb, resetDbForTests } = await import("../src/lib/db");
    resetDbForTests();
    const now = "2026-11-27T01:00:00.000Z";
    getDb()
      .prepare(
        `INSERT INTO users (username, password_hash, role, created_at, updated_at)
         VALUES ('ada', 'x', 'admin', ?, ?)`
      )
      .run(now, now);
    const project = getDb()
      .prepare(
        `INSERT INTO projects (name, slug, code, github_url, created_at, updated_at)
         VALUES ('Bugboard', 'bugboard', 'BUGBOARD', 'https://github.com/acme/bugboard', ?, ?)`
      )
      .run(now, now);
    const projectId = Number(project.lastInsertRowid);
    const { readCodeGraph, readCodeGraphHtml, saveCodeGraph } = await import("../src/lib/code-graph-store");
    const admin = { kind: "user" as const, userId: 1, role: "admin" as const, username: "ada" };
    const user = { kind: "user" as const, userId: 2, role: "user" as const, username: "bea" };
    expect(() => saveCodeGraph(user, projectId, { sha: "abc1234abc", report: "x" })).toThrow(/管理员/);
    const saved = saveCodeGraph(admin, projectId, {
      sha: "abc1234abc",
      report: "## Summary\n- 10 nodes · 20 edges · 2 communities\n\n## God Nodes\n1. `getDb()` - 4 edges\n",
      nodes: 10,
      edges: 20,
      html: Buffer.from("<p>graph</p>").toString("base64"),
    });
    expect(saved?.nodes).toBe(10);
    expect(saved?.hasHtml).toBe(true);
    expect(readCodeGraph(admin, projectId)?.body).toContain("getDb()");
    expect(readCodeGraphHtml(admin, projectId)?.toString()).toContain("graph");
    const packed = saveCodeGraph(admin, projectId, {
      sha: "abc1234abc",
      report: "## Summary\n- 10 nodes · 20 edges · 2 communities\n",
      nodes: 10,
      edges: 20,
      html: gzipSync(Buffer.from("<p>packed</p>")).toString("base64"),
    });
    expect(packed?.hasHtml).toBe(true);
    expect(readCodeGraphHtml(admin, projectId)?.toString()).toContain("packed");
  });

  it("retries the report without html when the upload connection drops", async () => {
    const htmlPath = path.join(tmpRoot, "graph.html");
    fs.writeFileSync(htmlPath, "<p>graph</p>");
    const { publishCodeGraph } = await import("../scripts/code-graph.mjs");
    const calls: { html?: string }[] = [];
    const result = await publishCodeGraph(
      {
        baseUrl: "http://127.0.0.1:3080",
        token: "bb_test",
        projectId: 3,
        sha: "abc1234abc",
        report: "## Summary\n- 10 nodes · 20 edges · 1 communities\n",
        nodes: 10,
        edges: 20,
        htmlPath,
      },
      async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body) as { html?: string };
        calls.push(body);
        if (body.html) throw new Error("socket");
        return new Response(JSON.stringify({ graph: { body: "ok" } }), { status: 200 });
      }
    );
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1].html).toBeUndefined();
  });
});
