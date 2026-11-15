import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBugboardMcpServer } from "../mcp/create-server";

afterEach(() => {
  vi.unstubAllGlobals();
});

async function connect() {
  const mcp = createBugboardMcpServer({
    baseUrl: "https://bugboard.test",
    apiKey: "bb_test",
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "release-tools", version: "0.0.1" });
  await Promise.all([client.connect(clientTransport), mcp.connect(serverTransport)]);
  return client;
}

describe("release MCP tools", () => {
  it("registers change and release tools and points submit_fix at 待发布", async () => {
    const client = await connect();
    try {
      const listed = await client.listTools();
      const byName = new Map(listed.tools.map((tool) => [tool.name, tool]));
      for (const name of [
        "record_change",
        "list_changes",
        "list_pending_release",
        "run_release",
        "mark_released",
      ]) {
        expect(byName.has(name), name).toBe(true);
      }
      expect(byName.get("submit_fix")?.description).toContain("→ 待发布");
      expect(byName.get("list_bugs")?.description).toContain("待发布");
      expect(JSON.stringify(byName.get("list_bugs")?.inputSchema)).toContain("ready_to_release");
      expect(byName.get("withdraw_fix")?.description).toContain("待发布 → 修复中");
      const runRelease = byName.get("run_release")?.description || "";
      expect(runRelease).toContain("入队等待本机发布任务");
      expect(runRelease).toContain("发布 runner");
      expect(runRelease).toContain("也不会马上上线");
      expect(runRelease).toContain("awaiting_confirm");
      expect(runRelease).not.toContain("马上跑");
    } finally {
      await client.close();
    }
  });

  it("calls the release API for mark and run", async () => {
    const seen: { url: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      seen.push({ url, body });
      if (url.endsWith("/release") && body?.mode === "mark") {
        return Response.json({ release: { id: 4, kind: "release" }, bugIds: [8] });
      }
      if (url.endsWith("/release") && body?.mode === "run") {
        return Response.json({ queued: true, dispatchId: 9 });
      }
      if (url.endsWith("/changes") && init?.method === "POST") {
        return Response.json({ change: { id: 3, kind: body.kind } }, { status: 201 });
      }
      if (url.includes("/changes?")) {
        return Response.json({ changes: [], total: 0 });
      }
      if (url.endsWith("/release") && (!init?.method || init.method === "GET")) {
        return Response.json({ bugs: [{ id: 8 }], changes: [] });
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const client = await connect();
    try {
      const marked = await client.callTool({
        name: "mark_released",
        arguments: { projectId: 2, trigger: "external", bugIds: [8], headSha: "abc" },
      });
      const ran = await client.callTool({
        name: "run_release",
        arguments: { projectId: 2, bugIds: [8] },
      });
      const recorded = await client.callTool({
        name: "record_change",
        arguments: {
          projectId: 2,
          kind: "fix",
          title: "修好按钮",
          commitShas: ["abc"],
          bugIds: [8],
        },
      });
      const pending = await client.callTool({
        name: "list_pending_release",
        arguments: { projectId: 2 },
      });

      const text = (res: { content?: { type: string; text?: string }[]; isError?: boolean }) =>
        res.content?.find((item) => item.type === "text")?.text || "";
      expect(marked.isError).toBeFalsy();
      expect(JSON.parse(text(marked)).bugIds).toEqual([8]);
      expect(JSON.parse(text(ran)).queued).toBe(true);
      expect(JSON.parse(text(recorded)).change.kind).toBe("fix");
      expect(JSON.parse(text(pending)).bugs).toEqual([{ id: 8 }]);
      expect(seen).toContainEqual({
        url: "https://bugboard.test/api/projects/2/release",
        body: { mode: "mark", trigger: "external", bugIds: [8], headSha: "abc" },
      });
      expect(seen).toContainEqual({
        url: "https://bugboard.test/api/projects/2/release",
        body: { mode: "run", trigger: "manual", bugIds: [8] },
      });
      expect(seen).toContainEqual({
        url: "https://bugboard.test/api/projects/2/changes",
        body: { kind: "fix", title: "修好按钮", commitShas: ["abc"], bugIds: [8] },
      });
      expect(seen.map((item) => item.url)).toContain(
        "https://bugboard.test/api/projects/2/release"
      );
    } finally {
      await client.close();
    }
  });
});