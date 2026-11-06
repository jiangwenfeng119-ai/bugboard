#!/usr/bin/env node
/**
 * Bugboard MCP server (stdio).
 * Env: BUGBOARD_BASE_URL, BUGBOARD_API_KEY
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBugboardMcpServer } from "./create-server";

async function main() {
  const server = createBugboardMcpServer({
    baseUrl: process.env.BUGBOARD_BASE_URL || "http://127.0.0.1:3000",
    apiKey: process.env.BUGBOARD_API_KEY || "",
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function launchedAsCli() {
  const entry = process.argv[1];
  if (!entry) return false;
  return pathToFileURL(path.resolve(entry)).href === import.meta.url;
}

if (launchedAsCli()) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
