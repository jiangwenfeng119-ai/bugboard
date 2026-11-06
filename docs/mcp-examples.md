# MCP 接入（标准协议）

Bugboard 提供两种接法，管理后台「API Key」页可以分别复制：

- **远端 Agent**：`https://<服务地址>/mcp`，Streamable HTTP。请求头 `Authorization: Bearer <API Key>`。任何支持远程 MCP 的客户端都能装，不需要本机仓库。
- **本机 Agent**：`npx tsx mcp/server.ts` 的 stdio 进程，用环境变量 `BUGBOARD_BASE_URL` 和 `BUGBOARD_API_KEY` 调用 REST。适合只支持本地命令的客户端。

Cursor 把配置写在项目 `.cursor/mcp.json`。其他客户端使用各自的 `mcpServers` 配置；远程连接如果要求传输类型，使用 `"type": "http"`。

## 1. 在管理后台创建两个 API Key

| Key 名称 | 角色 | 用途 |
|---------|------|------|
| `cursor-qa` | 用户级，绑定目标项目 | 提报、确认/打回/异议 |
| `cursor-fixer` | 管理员级 | 接单、提交修复、标不属实 |

明文 Key 仅创建时显示一次。

## 2. 项目内配置

复制示例并填入真实 Key：

```bash
cp .cursor/mcp.json.example .cursor/mcp.json
```

示例内容：

```json
{
  "mcpServers": {
    "bugboard-qa": {
      "command": "npx",
      "args": ["tsx", "mcp/server.ts"],
      "env": {
        "BUGBOARD_BASE_URL": "http://127.0.0.1:3080",
        "BUGBOARD_API_KEY": "<用户级 Key 明文>"
      }
    },
    "bugboard-fixer": {
      "command": "npx",
      "args": ["tsx", "mcp/server.ts"],
      "env": {
        "BUGBOARD_BASE_URL": "http://127.0.0.1:3080",
        "BUGBOARD_API_KEY": "<管理员级 Key 明文>"
      }
    }
  }
}
```

`.cursor/mcp.json` 含密钥，已在 `.gitignore` 中忽略；提交仓库请只用 `.example`。

配置后在 Cursor Settings → MCP 确认 `bugboard-qa` / `bugboard-fixer` 已连接（或重载窗口）。

## 3. 工具一览

| 工具 | QA | Fixer |
|------|:--:|:-----:|
| `list_projects` | ✓ | ✓ |
| `get_project_stats` | ✓ | ✓ |
| `list_bugs` / `get_bug` | ✓ | ✓ |
| `create_bug` | ✓ | ✓ |
| `confirm_fix` / `reject_fix` / `dispute_invalid` / `provide_info` | 仅自己提的单 | 仅自己提的单 |
| `start_fix` / `submit_fix` / `mark_invalid` / `request_info` | | ✓ |

## 4. 推荐闭环

1. **bugboard-qa**：`create_bug` → 得到 `bugId`
2. **bugboard-fixer**：`start_fix` → `submit_fix`（必填 note）
3. **bugboard-qa**：`confirm_fix`，或 `reject_fix` 打回
4. 材料只在报障人手里时，**bugboard-fixer** 用 `request_info` 把单退到待补充；原报障人补上后用 `provide_info` 回到待处理

本地脚本验证（不依赖 Cursor UI）：

```bash
npm run mcp:smoke
```
