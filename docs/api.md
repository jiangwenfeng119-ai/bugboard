# API

网页和 Agent 走同一套 REST。MCP 是这套 REST 的另一层入口，工具名和参数见 [`mcp-examples.md`](mcp-examples.md)。

## 认证

除下面写明「无需登录」的接口外，请求都要带身份：

- 网页登录后的 cookie，名称 `bugboard_session`。
- 或请求头 `Authorization: Bearer <API Key>`。有这个头且 Key 有效时，优先当成 API Key，不再看 cookie。

无效或缺失时，走 `withAuth` 的接口返回 `401`，正文 `{ "error": "未登录" }`。业务错误一般是 `400`，正文 `{ "error": "<中文说明>" }`。整句等于已知的权限说明时是 `403`，等于「文件丢失」或以「不存在」结尾时是 `404`。数据库唯一约束冲突不把驱动原文返回，而是 `409`，正文「请求冲突，请重试」。

这里的「管理员」在不同接口上不是同一件事：

- 开户、项目、成员、API Key、分派配置、行为配置、手动分派：账号角色是管理员或超级管理员（`requireAdmin`）。
- 改报障状态、改优先级、登记变更、发布入队和领取：人要是该项目成员里的管理员；管理员级 API Key 在它能访问的项目上视为项目管理员（`isProjectAdmin`）。
- 删除项目、删除报障：账号角色必须是超级管理员。

API Key 只有 `user` 和 `admin`。用户级必须至少绑定一个项目。管理员级可不绑定（访问全部项目），也可绑定后仅限所选项目。

## MCP

`src/app/mcp/route.ts` 把 `/mcp` 交给 `handleMcpRequest`。

| 方法 | 结果 |
|------|------|
| `OPTIONS` | `204`，带 CORS |
| `POST`、`DELETE` | 需要 `Authorization: Bearer <API Key>`。无有效 Key 时 `401`，JSON-RPC 错误「需要有效的 API Key」 |
| `GET` 以及其他方法 | `405`。这里不做长连接 SSE；客户端把 405 当成「没有服务端主动推流」 |

工具在本进程里再调 REST，基址是 `http://127.0.0.1:$PORT`（`PORT` 缺省 `3000`），不用浏览器看到的 Host。

本机 stdio 进程是 `mcp/server.ts`，用环境变量 `BUGBOARD_BASE_URL`（缺省 `http://127.0.0.1:3000`）和 `BUGBOARD_API_KEY`。

## 无需登录

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/setup` | `{ setupRequired }`。库里还没有用户时为 true |
| `POST` | `/api/setup` | 仅首装。正文 `username`、`password`（至少 6 位）。成功后写入 session，角色为超级管理员。已首装返回 400 |
| `POST` | `/api/auth/login` | 正文 `username`、`password`。成功写入 session。失败 401；同一用户名 10 分钟内失败满 8 次，或同一 IP 满 40 次，返回 429 |
| `POST` | `/api/auth/logout` | 销毁当前 session，不校验是否已登录 |
| `OPTIONS` | `/api/widget/[token]/bugs` | `204`，CORS 允许任意来源的 `POST` |
| `POST` | `/api/widget/[token]/bugs` | 嵌入式上报。身份是 URL 里的 widget token，不是登录态。`multipart/form-data`，字段含 `title`、`note`、`pageUrl`、`viewport`、`userAgent`、`consoleText`、`file`。同一 token 加 IP，10 分钟最多 30 次 |

## 登录后的 REST

路径里的 `[id]` 是数字 ID。项目接口的 `[id]` 是项目 ID，报障接口的 `[id]` 是报障 ID。

### 自己和账号

| 方法 | 路径 | 谁 | 说明 |
|------|------|----|------|
| `GET` | `/api/me` | 已登录 | 当前身份。用户含 `userId`、`username`、`role`；Key 含 `apiKeyId`、`name`、`role`、`projectIds` |
| `POST` | `/api/me/password` | 人类用户 | 正文 `currentPassword`、`newPassword`。新密码至少 6 位，且不能与当前密码相同 |
| `GET` | `/api/users` | 账号管理员 | 用户列表 |
| `POST` | `/api/users` | 账号管理员 | 创建用户。正文 `username`、`password`、`role`（`user` / `admin` / `superadmin`，缺省 `user`）。任命超级管理员只有超级管理员能做 |
| `PATCH` | `/api/users/[id]` | 账号管理员 | 改 `username`、`role`、`password`，或另一次请求里用 `active` 启用/禁用。同一请求里如果带了前三项，就不会处理 `active`。普通管理员不能改超级管理员。把最后一个超级管理员降级、或在没有超级管理员时把最后一个仍启用的管理员降成用户，都会拒绝。禁用不能关掉最后一个仍启用的超级管理员，也不能禁用当前登录账号 |
| `DELETE` | `/api/users/[id]` | 账号管理员 | 删除用户。不能删当前登录账号，不能删最后一个超级管理员；没有超级管理员时也不能删掉最后一个仍启用的管理员 |
| `GET` | `/api/api-keys` | 账号管理员 | Key 列表。含前缀、角色、绑定项目、最近使用、调用次数。不含明文 |
| `POST` | `/api/api-keys` | 人类账号管理员 | 创建。正文 `name`、`role`（`user` 或 `admin`）、用户级还要 `projectIds`。响应里的明文只此一次 |
| `PATCH` | `/api/api-keys/[id]` | 人类账号管理员 | 改名称、角色、绑定项目、禁用，或重新生成 |
| `DELETE` | `/api/api-keys/[id]` | 账号管理员，含管理员级 Key | 物理删除。创建和修改则必须是人类管理员 |

### 项目

| 方法 | 路径 | 谁 | 说明 |
|------|------|----|------|
| `GET` | `/api/projects` | 已登录 | 可见项目。每项含 `openCount`、`pendingCount`、`awaitingConfirmCount`、`needsInfoCount` 和 `documents`。待发布数量在计数对象里有，但这条响应没有单独返回 |
| `POST` | `/api/projects` | 账号管理员 | 创建。名称必填。缩写留空则生成；手写须为 2–8 位、字母开头、大写字母或数字，且不能与已有缩写相同或互为前缀 |
| `GET` | `/api/projects/[id]` | 能看该项目的人 | 单个项目 |
| `PATCH` | `/api/projects/[id]` | 账号管理员 | 改名称、缩写、说明和项目资料。只改传入字段 |
| `DELETE` | `/api/projects/[id]` | 超级管理员 | 删除项目及其报障、附件、成员 |
| `GET` | `/api/projects/[id]/stats` | 能看该项目的人 | 汇总。查询 `days` 为 7、30 或 90，MCP 缺省按 30 |
| `GET` | `/api/projects/[id]/members` | 账号管理员 | 成员及项目角色 |
| `POST` | `/api/projects/[id]/members` | 账号管理员 | 加入成员。正文 `userIds`（或单个 `userId`）和 `role`（`user` 或 `admin`，缺省 `user`） |
| `PATCH` | `/api/projects/[id]/members` | 账号管理员 | 改项目角色。正文 `userId`、`role` |
| `DELETE` | `/api/projects/[id]/members?userId=` | 账号管理员 | 移出成员 |
| `GET` | `/api/projects/[id]/logo` | 能看该项目的人 | 当前 logo |
| `POST` | `/api/projects/[id]/logo` | 账号管理员 | 上传并替换。png、jpg、jpeg、webp，不超过 2MB，且文件头要和扩展名一致 |
| `DELETE` | `/api/projects/[id]/logo` | 账号管理员 | 移除 logo |
| `POST` | `/api/projects/[id]/documents` | 账号管理员 | 上传设计稿或需求文档。表单字段 `kind` 为 `design` 或 `docs`。每种最多 20 个 |
| `GET` | `/api/projects/[id]/documents/[docId]` | 能看该项目的人 | 下载一份资料附件 |
| `DELETE` | `/api/projects/[id]/documents/[docId]` | 账号管理员 | 删除一份资料附件 |
| `GET` | `/api/projects/[id]/widget` | 账号管理员 | 取或创建嵌入式上报 token，以及片段 |
| `POST` | `/api/projects/[id]/widget` | 账号管理员 | 轮换 token。新 token 的归属用户是当前登录的管理员 |

### 报障

状态与动作以 `src/lib/state-machine.ts` 为准，中文名见 README「状态怎么走」。

| 方法 | 路径 | 谁 | 说明 |
|------|------|----|------|
| `GET` | `/api/projects/[id]/bugs` | 能看该项目的人 | 列表。查询 `status`、`priority`、`q`、`reporter`、`sort`、`dir` |
| `POST` | `/api/projects/[id]/bugs` | 能看该项目的人 | 创建。JSON 或 `multipart/form-data`。`title` 必填，`priority` 缺省 `p2`。可带正文、原话、步骤、圈选和 `attachmentIds`，或直接上传 `files`。标题最长 200 字，正文最长 20000 字 |
| `GET` | `/api/bugs/[id]` | 能看该项目的人 | 详情、时间线、附件、当前允许的动作。能补充说明时，`actions` 里含 `add_supplement` |
| `PATCH` | `/api/bugs/[id]` | 项目管理员 | 正文只认 `priority`（`p1` / `p2` / `p3`）。别的字段返回「无有效字段」 |
| `DELETE` | `/api/bugs/[id]` | 超级管理员 | 删除该报障、附件和流转 |
| `POST` | `/api/bugs/[id]/transitions` | 按动作 | JSON `{ action, note }`，或表单 `action`、`note`、`files`。动作名就是状态机里的 `start_fix`、`submit_fix` 等。说明是否必填看该动作 |
| `POST` | `/api/bugs/[id]/supplements` | 项目管理员随时；原报障人仅待处理 | 正文 `{ note }`。不改状态 |
| `GET` | `/api/bugs/[id]/attachments` | 能看该项目的人 | 列出该报障的附件 |
| `POST` | `/api/bugs/[id]/attachments` | 能看该项目的人 | 追加附件。单文件 50MB，一条最多 20 个 |
| `GET` | `/api/attachments/[id]` | 能看所属项目的人 | 下载附件 |
| `POST` | `/api/projects/[id]/uploads` | 能看该项目的人 | 暂存文件，供创建报障时用 `attachmentIds` 引用。网页上限 50MB；MCP `stage_attachment` 在调用前把上限收成 8MB |
| `POST` | `/api/bugs/[id]/wake` | 账号管理员 | 手动分派去修理。只接受待处理，或上一条流转是从待产品经理确认到修复中。不受一分钟自动去重限制 |
| `POST` | `/api/projects/[id]/transcribe` | 能看该项目的人 | 表单字段 `file`，不超过 50MB。配齐 `ASR_BASE_URL` 与 `ASR_API_KEY` 时转写；否则 `{ available: false }` |

### 走查

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/projects/[id]/captures` | 列出走查 |
| `POST` | `/api/projects/[id]/captures` | 新建走查。`multipart/form-data`：`transcript`（JSON 数组）、`durationSec`、`truncated`（`"1"` 表示截断）、`video`、`frames`（JSON 数组，元素可含 `t`、`note`、`strokes`）。每一帧还要有文件字段 `frame-0`、`frame-1`……创建后会尝试分派整理 |
| `GET` | `/api/projects/[id]/captures/[sessionId]` | 转写和草稿 |
| `PUT` | `/api/projects/[id]/captures/[sessionId]` | 修改已有草稿。MCP 工具 `update_capture_drafts` |
| `POST` | `/api/projects/[id]/captures/[sessionId]/drafts` | 整批替换草稿。MCP 工具 `replace_capture_drafts`，1 到 20 条 |
| `POST` | `/api/projects/[id]/captures/[sessionId]/organize` | 跳过正在进行的整理。正文必须是 `{ "action": "skip" }`，成功后整理状态为 `skipped`。这不是发起整理；发起整理在创建走查时由分派完成 |
| `POST` | `/api/projects/[id]/captures/[sessionId]/commit` | 人确认后把草稿收成报障 |
| `GET` | `/api/captures/[sessionId]/video` | 走查录像 |
| `GET` | `/api/captures/[sessionId]/frames/[draftId]` | 某一草稿的截图 |

走查这几条都要求登录，并且能访问该项目。草稿字段和状态的完整形状以 `mcp/create-server.ts` 里对应工具的参数为准；REST 若另有未在工具里出现的字段，待确认：走查提交与整理接口的完整表单字段是否还要单独写成请求样例。

### 变更与发布

| 方法 | 路径 | 谁 | 说明 |
|------|------|----|------|
| `GET` | `/api/projects/[id]/changes` | 能看该项目的人 | 分页。查询 `kind`（`fix`、`feature`、`chore`、`release` 或 `code`）、`limit`（最大 100）、`offset` |
| `POST` | `/api/projects/[id]/changes` | 项目管理员 | 登记已 push 的变更。`kind` 不能是 `release`。`title`、`commitShas` 必填 |
| `GET` | `/api/projects/[id]/release` | 项目管理员 | 待发布报障，以及还没挂上发布的代码变更 |
| `POST` | `/api/projects/[id]/release` | 项目管理员 | `mode=run` 只入队。`mode=mark` 记一次外部发布；`result` 缺省 `success`。`trigger` 为 `scheduled`、`manual` 或 `external`。失败只记账，不改报障状态。成功是否把待发布推进到待确认，看该项目行为里的开关，默认会推进 |
| `POST` | `/api/releases/runner` | 账号管理员，且领取时还要是项目管理员 | 发布 runner 专用。正文 `op`：`claim`（可带 `project` 缩写或 slug）、`schedule`（可带 `at`，缺省为固定东八区的当前 `HH:MM`）、`finish`（`dispatchId`、`result`，以及可选的 `headSha`、`detail`） |

### 分派与行为

| 方法 | 路径 | 谁 | 说明 |
|------|------|----|------|
| `GET` | `/api/projects/[id]/dispatch` | 账号管理员 | 叫醒和发布配置 |
| `PUT` | `/api/projects/[id]/dispatch` | 账号管理员 | 保存。发布方式 `none`、`restart`、`ecs_deploy`。发布命令非空时必须是绝对路径，规则与 runner 相同 |
| `POST` | `/api/projects/[id]/dispatch` | 账号管理员 | 测试本机地址 |
| `DELETE` | `/api/projects/[id]/dispatch` | 账号管理员 | 清除该项目的分派配置 |
| `GET` | `/api/projects/[id]/behavior` | 账号管理员 | 行为开关 |
| `PUT` | `/api/projects/[id]/behavior` | 账号管理员 | 整份保存。布尔项、叫醒动作列表、默认优先级，以及整数范围：待处理条数 1–30，发布超时 5–180，走查停顿 200–10000 毫秒，短句字数 1–40，整理超时 1–60。字段名与默认值见 `src/lib/behavior-shared.ts` 的 `behaviorDefaults` |
