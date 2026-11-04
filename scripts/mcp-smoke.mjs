#!/usr/bin/env node
/**
 * End-to-end MCP lifecycle smoke: QA create → Fixer fix → QA confirm.
 * Reads .env.mcp.local or process env.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env.mcp.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const BASE = process.env.BUGBOARD_BASE_URL || "http://127.0.0.1:3000";
const QA = process.env.BUGBOARD_QA_KEY;
const FIXER = process.env.BUGBOARD_FIXER_KEY;
const PROJECT_ID = Number(process.env.BUGBOARD_PROJECT_ID || "3");

if (!QA || !FIXER) {
  console.error("缺少 BUGBOARD_QA_KEY / BUGBOARD_FIXER_KEY（可写 .env.mcp.local）");
  process.exit(1);
}

async function withClient(apiKey, fn) {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "mcp/server.ts"],
    cwd: root,
    env: {
      ...process.env,
      BUGBOARD_BASE_URL: BASE,
      BUGBOARD_API_KEY: apiKey,
    },
  });
  const client = new Client({ name: "bugboard-smoke", version: "0.1.0" });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

async function callTool(client, name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.find((c) => c.type === "text")?.text || "";
  const data = JSON.parse(text);
  if (res.isError || data.error) {
    throw new Error(`${name}: ${data.error || text}`);
  }
  return data;
}

async function main() {
  // health
  const health = await fetch(`${BASE}/api/setup`);
  if (!health.ok) throw new Error(`Bugboard 不可达: ${BASE}`);

  const toolsQa = await withClient(QA, async (c) => {
    const listed = await c.listTools();
    const names = listed.tools.map((t) => t.name).sort();
    console.log("QA tools:", names.join(", "));
    const created = await callTool(c, "create_bug", {
      projectId: PROJECT_ID,
      title: `MCP smoke ${new Date().toISOString()}`,
      body: "scripts/mcp-smoke.mjs",
      priority: "p2",
    });
    return { names, bugId: created.bug.id };
  });

  await withClient(FIXER, async (c) => {
    await callTool(c, "start_fix", { bugId: toolsQa.bugId });
    await callTool(c, "submit_fix", {
      bugId: toolsQa.bugId,
      note: "MCP smoke 修复说明",
    });
  });

  const confirmed = await withClient(QA, async (c) => {
    await callTool(c, "confirm_fix", { bugId: toolsQa.bugId });
    return callTool(c, "get_bug", { bugId: toolsQa.bugId });
  });

  if (confirmed.bug.status !== "confirmed") {
    throw new Error(`期望 confirmed，实际 ${confirmed.bug.status}`);
  }
  console.log("OK bug", toolsQa.bugId, "→", confirmed.bug.status);
  console.log(
    "timeline actors:",
    confirmed.events.map((e) => e.actorLabel).join(" → ")
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
