import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const tmpRoot = path.join(os.tmpdir(), `bugboard-mcp-http-${process.pid}`);

beforeEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(tmpRoot, { recursive: true });
  process.env.DATA_DIR = tmpRoot;
  process.env.DB_PATH = path.join(tmpRoot, "db", "test.sqlite");
  process.env.UPLOADS_DIR = path.join(tmpRoot, "uploads");
});

afterEach(async () => {
  vi.unstubAllGlobals();
  const { resetDbForTests } = await import("../src/lib/db");
  resetDbForTests();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("remote mcp endpoint", () => {
  it("rejects a request without a usable api key", async () => {
    const { handleMcpRequest } = await import("../src/lib/mcp-http");
    const res = await handleMcpRequest(
      new Request("https://bugboard.example/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
    );
    expect(res.status).toBe(401);
  });

  it("lists projects over streamable http using the request's api key", async () => {
    const services = await import("../src/lib/services");
    const { handleMcpRequest } = await import("../src/lib/mcp-http");
    const admin = await services.setupAdmin("admin", "secret1");
    const created = services.createApiKey(
      {
        kind: "user",
        userId: admin.id,
        role: "admin",
        username: admin.username,
      },
      { name: "remote-agent", role: "admin" }
    );

    const seen: { url: string; authorization: string | null }[] = [];
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const authorization = new Headers(init?.headers).get("authorization");
        seen.push({ url, authorization });
        if (url === "https://bugboard.example/api/projects") {
          return Response.json({
            projects: [{ id: 2, name: "brandonapp" }],
          });
        }
        return Response.json({ error: `unexpected ${url}` }, { status: 500 });
      }
    );

    const transport = new StreamableHTTPClientTransport(
      new URL("https://bugboard.example/mcp"),
      {
        requestInit: {
          headers: { Authorization: `Bearer ${created.rawKey}` },
        },
        fetch: async (url, init) =>
          handleMcpRequest(new Request(url, init)),
      }
    );
    const client = new Client({ name: "remote-test", version: "0.0.1" });
    await client.connect(transport);
    try {
      const res = await client.callTool({
        name: "list_projects",
        arguments: {},
      });
      const text =
        res.content?.find((item) => item.type === "text")?.text || "";
      const data = JSON.parse(text);
      expect(data.projects).toEqual([{ id: 2, name: "brandonapp" }]);
      expect(seen).toContainEqual({
        url: "https://bugboard.example/api/projects",
        authorization: `Bearer ${created.rawKey}`,
      });
    } finally {
      await client.close();
    }
  });
});
