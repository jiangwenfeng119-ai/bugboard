#!/usr/bin/env node
import path from "node:path";
import { gitSync, syncConfiguredMirrors } from "./ask-runner.mjs";
import { refreshProjectGraphs } from "./code-graph.mjs";
import { readConfig } from "./wake-agent.mjs";

const cwd = path.resolve(process.argv[2] || process.cwd());
const only = String(process.argv[3] || "");
const config = readConfig(process.env, cwd);
if (!config.bugboardUrl || !config.releaseKey) {
  console.error("wake.config.json 里要有 bugboardUrl 和 releaseKey");
  process.exit(1);
}

const res = await fetch(`${String(config.bugboardUrl).replace(/\/$/, "")}/api/projects`, {
  headers: { Authorization: `Bearer ${config.releaseKey}` },
});
if (!res.ok) {
  console.error(`读取项目清单失败 HTTP ${res.status}`);
  process.exit(1);
}
const data = await res.json();
const projects = Array.isArray(data.projects)
  ? data.projects.map((item) => ({
      id: item.id,
      code: item.code,
      githubUrl: item.github_url,
      defaultBranch: item.default_branch,
    }))
  : [];
const listed = only ? projects.filter((item) => item.code === only) : projects;
const synced = syncConfiguredMirrors(config, listed, gitSync);
for (const item of synced) {
  if (item.error) console.error(`问答镜像 ${item.code}：${item.error}`);
  else console.log(`问答镜像 ${item.code} ${String(item.sha).slice(0, 7)}`);
}
const results = await refreshProjectGraphs(config, listed, gitSync, { publishOnSkip: true });
const failed = results.filter((item) => item.error || item.published === false);
if (failed.length) process.exit(1);
