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

仓库里的示例是 `.cursor/mcp.json.example`。复制后的内容如下。Key 从环境变量读，不把明文写进文件：

```json
{
  "mcpServers": {
    "bugboard-qa": {
      "command": "npx",
      "args": ["tsx", "${workspaceFolder}/mcp/server.ts"],
      "env": {
        "BUGBOARD_BASE_URL": "http://127.0.0.1:3080",
        "BUGBOARD_API_KEY": "${env:BUGBOARD_QA_KEY}"
      }
    },
    "bugboard-fixer": {
      "command": "npx",
      "args": ["tsx", "${workspaceFolder}/mcp/server.ts"],
      "env": {
        "BUGBOARD_BASE_URL": "http://127.0.0.1:3080",
        "BUGBOARD_API_KEY": "${env:BUGBOARD_FIXER_KEY}"
      }
    }
  }
}
```

`3080` 是 Docker 映射到主机的端口。本机 `npm run dev` 时，`mcp/server.ts` 在未设置 `BUGBOARD_BASE_URL` 的情况下会连 `http://127.0.0.1:3000`。

`.cursor/mcp.json` 含密钥，已在 `.gitignore` 中忽略；提交仓库请只用 `.example`。

配置后在 Cursor Settings → MCP 确认 `bugboard-qa` / `bugboard-fixer` 已连接（或重载窗口）。

## 3. 工具一览

「QA」是用户级 Key，「Fixer」是管理员级 Key。管理员级 Key 在它能访问的项目上视为项目管理员，并且只有超级管理员能创建、修改或删除。账号管理员可以创建用户级 Key。用户级 Key 不能改别人的单，也不能做处理动作。

| 工具 | QA | Fixer |
|------|:--:|:-----:|
| `list_projects` | ✓ | ✓ |
| `get_project_stats` | ✓ | ✓ |
| `list_bugs` / `get_bug` | ✓ | ✓ |
| `create_bug` | ✓ | ✓ |
| `stage_attachment` | ✓ | ✓ |
| `list_captures` / `get_capture` / `update_capture_drafts` / `replace_capture_drafts` | ✓ | ✓ |
| `confirm_fix` | 仅自己提的单 | 自己提的单；API Key 提交且待确认的单也可以 |
| `reject_fix` / `dispute_invalid` / `accept_invalid` / `provide_info` | 仅自己提的单 | 仅自己提的单 |
| `add_supplement` | 仅自己提的、且仍是待处理 | 任意时候 |
| `start_fix` / `submit_fix` / `withdraw_fix` | | ✓ |
| `mark_invalid` / `request_product` / `decline_product` / `accept_product` / `request_info` / `reopen_invalid` | | ✓ |
| `record_change` / `list_pending_release` / `run_release` / `mark_released` | | ✓ |
| `list_changes` | 能看该项目即可 | 能看该项目即可 |
| `update_project_docs` / `upload_project_document` / `remove_project_document` | | ✓ |
| `upload_project_logo` / `remove_project_logo` | | ✓ |

`stage_attachment` 在进 REST 之前拒绝超过 8MB 的文件。网页上传上限是 50MB。

`accept_product` 由 API Key 调用时不会再自动分派一轮。登录用户点「可以做」才会。

`run_release` 只入队，返回 `queued`。默认不要调用。`mark_released` 不跑部署；失败只记账。成功后报障会不会进入待确认，看该项目「行为」里的开关，默认会。

## 4. 推荐闭环

1. **bugboard-qa**：`create_bug` → 得到 `bugId`
2. **bugboard-fixer**：`start_fix` → 改完并 push → `submit_fix`（必填 note，进入待发布）→ `record_change`（`kind=fix`，带上 `bugIds` 和 `commitShas`）。要一个现在没有的能力、而且提交时还没写已经确认，用 `request_product`，不要 `mark_invalid`
3. 看队列：`list_pending_release`。人明确要求紧急发布时才 `run_release`（只入队，不会马上上线）。外部已经发布完成则 `mark_released`。默认会把待发布变为待确认；该项目若关掉「发布后推进」，成功也留在待发布。不要在待发布时 `confirm_fix`
4. **bugboard-qa**：只对 `awaiting_confirm` 做 `confirm_fix`，或 `reject_fix` 打回
5. 材料只在报障人手里时，**bugboard-fixer** 用 `request_info` 把单退到待补充；原报障人补上后用 `provide_info` 回到待处理

本地脚本验证（不依赖 Cursor UI）：

```bash
npm run mcp:smoke
```
