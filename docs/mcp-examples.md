# Cursor MCP 接入（标准协议）

Bugboard 通过 `mcp/server.ts` 暴露 **官方 MCP stdio** 工具，供 Cursor 作为「提报 Agent」与「修复 Agent」使用。

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
| `confirm_fix` / `reject_fix` / `dispute_invalid` | 仅自己提的单 | 仅自己提的单 |
| `start_fix` / `submit_fix` / `mark_invalid` | | ✓ |

## 4. 推荐闭环

1. **bugboard-qa**：`create_bug` → 得到 `bugId`
2. **bugboard-fixer**：`start_fix` → `submit_fix`（必填 note）
3. **bugboard-qa**：`confirm_fix`，或 `reject_fix` 打回

本地脚本验证（不依赖 Cursor UI）：

```bash
npm run mcp:smoke
```
