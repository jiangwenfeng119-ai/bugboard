export type McpHandoffInput = {
  baseUrl: string;
  keyId: number;
  keyName: string;
  role: "user" | "admin";
  projectNames: string[];
  keyPrefix: string;
  rawKey: string | null;
  mcpScriptPath: string | null;
  status: "active" | "disabled" | "revoked";
};

function slug(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function mcpServerId(
  name: string,
  role: "user" | "admin",
  keyId: number
) {
  const fromName = slug(name);
  if (fromName) return `bugboard-${fromName}`;
  return role === "admin" ? `bugboard-fixer-${keyId}` : `bugboard-qa-${keyId}`;
}

function hostnameOf(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function isLoopback(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

/** Prefer the page the admin is actually using. A loopback page falls back to the configured public URL. */
export function resolveBugboardBaseUrl(
  pageOrigin: string,
  configured: string | null | undefined
) {
  const origin = pageOrigin.replace(/\/$/, "");
  const published = configured?.trim().replace(/\/$/, "") || "";
  const originHost = hostnameOf(origin);
  const publishedHost = published ? hostnameOf(published) : null;
  if (
    originHost &&
    isLoopback(originHost) &&
    publishedHost &&
    !isLoopback(publishedHost)
  ) {
    return published;
  }
  return origin;
}

function handoffFacts(input: McpHandoffInput) {
  const serverId = mcpServerId(input.keyName, input.role, input.keyId);
  const roleLabel = input.role === "admin" ? "管理员级" : "用户级";
  const access =
    input.role === "admin"
      ? "全部项目"
      : input.projectNames.length
        ? input.projectNames.join("、")
        : "未绑定项目";
  const apiKeyValue = input.rawKey ?? "REPLACE_WITH_FULL_KEY";
  const capability =
    input.role === "admin"
      ? "这个 Key 是管理员级，适合修复 Agent：可以接单（start_fix）、提交修复（submit_fix）、标记不属实（mark_invalid），材料只在报障人手里时可以要求补充（request_info），也可以撤回判错的不属实（reopen_invalid）或撤回已提交的修复（withdraw_fix）。可访问全部项目。不能代替报障人确认已修复或补充材料。"
      : "这个 Key 是用户级，适合提报 Agent：可以建单（create_bug），并对自己提的单确认、打回、提出异议，或在待补充时补上材料（provide_info）。不能接单或提交修复。";
  return { serverId, roleLabel, access, apiKeyValue, capability };
}

function missingKeyLine(input: McpHandoffInput, field: string) {
  if (input.rawKey) return input.rawKey;
  return `未包含明文（系统不保存明文，此前缀 ${input.keyPrefix}）。把你保存的完整 Key 填进下面 JSON 的 ${field}；若已丢失，在管理后台重新生成该 Key，再点一次对应的复制按钮。`;
}

function withStatus(input: McpHandoffInput, lines: string[]) {
  if (input.status === "disabled") {
    lines.unshift("注意：这个 Key 当前是禁用状态，连接前要先在管理后台启用。", "");
  } else if (input.status === "revoked") {
    lines.unshift("注意：这个 Key 已吊销，不能再连接。请改用新的 Key。", "");
  }
  return lines.join("\n");
}

export function buildLocalMcpHandoff(input: McpHandoffInput) {
  const { serverId, roleLabel, access, apiKeyValue, capability } =
    handoffFacts(input);
  const script =
    input.mcpScriptPath ?? "<本机 Bugboard 仓库绝对路径>/mcp/server.ts";
  const config = {
    mcpServers: {
      [serverId]: {
        command: "npx",
        args: ["-y", "tsx", script],
        env: {
          BUGBOARD_BASE_URL: input.baseUrl,
          BUGBOARD_API_KEY: apiKeyValue,
        },
      },
    },
  };
  const lines = [
    "请在运行 Agent 的这台机器上安装 Bugboard MCP（本机 stdio）。支持本地命令的客户端都能用，Cursor 只是其中一种。",
    "",
    "把下面这段合并进该客户端的 MCP 配置。Cursor 用项目里的 `.cursor/mcp.json`（没有这个文件就新建）。文件里有密钥，不要提交到 git。若已有同名 mcpServers 条目，覆盖那一条。",
    "",
    `服务地址：${input.baseUrl}`,
    `API Key 名称：${input.keyName}`,
    `角色：${roleLabel}`,
    `可访问项目：${access}`,
    `API Key：${missingKeyLine(input, "BUGBOARD_API_KEY")}`,
    "",
    "用 npx 在本机启动 Bugboard 的 mcp/server.ts。这个进程带着上面的地址和 Key 调用 Bugboard REST（请求头 Authorization: Bearer <API Key>）。不要把服务地址本身当成 MCP 地址。",
    `启动脚本：${script}`,
    input.mcpScriptPath
      ? "该目录需要已经执行过 npm install（依赖 @modelcontextprotocol/sdk；tsx 可由 npx 拉取）。如果 Agent 不在生成这段文字的机器上，把 JSON 里的脚本路径改成那台机器上 mcp/server.ts 的绝对路径。"
      : "把 JSON 里的脚本路径改成本机 Bugboard 仓库中 mcp/server.ts 的绝对路径，并确认该目录已经 npm install（依赖 @modelcontextprotocol/sdk；tsx 可由 npx 拉取）。",
    "",
    "```json",
    JSON.stringify(config, null, 2),
    "```",
    "",
    `写完后确认「${serverId}」已连接；没有出现就重载客户端。然后调用 list_projects，应能看到该 Key 可访问的项目。`,
    capability,
  ];
  return withStatus(input, lines);
}

export function buildRemoteMcpHandoff(input: McpHandoffInput) {
  const { serverId, roleLabel, access, apiKeyValue, capability } =
    handoffFacts(input);
  const mcpUrl = `${input.baseUrl.replace(/\/$/, "")}/mcp`;
  const config = {
    mcpServers: {
      [serverId]: {
        type: "http",
        url: mcpUrl,
        headers: {
          Authorization: `Bearer ${apiKeyValue}`,
        },
      },
    },
  };
  const lines = [
    "请把 Bugboard 接到当前 Agent 的远程 MCP。任何支持远程 MCP（Streamable HTTP）的客户端都可以装，不需要克隆仓库，也不要在本机启动进程。",
    "",
    `MCP 地址：${mcpUrl}`,
    "认证：请求头 Authorization: Bearer <API Key>",
    "不要把网站首页当成 MCP 地址。",
    "",
    `API Key 名称：${input.keyName}`,
    `角色：${roleLabel}`,
    `可访问项目：${access}`,
    `API Key：${missingKeyLine(input, "Authorization")}`,
    "",
    "把下面这段合并进该客户端的远程 MCP 配置。Cursor 用项目里的 `.cursor/mcp.json`。其他客户端使用各自的 mcpServers 配置；如果它要求声明传输类型，保留 JSON 里的 \"type\": \"http\"。文件里有密钥，不要提交到 git。若已有同名条目，覆盖那一条。",
    "",
    "```json",
    JSON.stringify(config, null, 2),
    "```",
    "",
    `连上后调用 list_projects，应能看到该 Key 可访问的项目。服务名是「${serverId}」。`,
    capability,
  ];
  return withStatus(input, lines);
}
