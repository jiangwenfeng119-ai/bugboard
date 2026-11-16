# Bugboard 只读审计（2026-11-17）

范围：仓库根目录当前实现（`src/`、`mcp/`、`scripts/`、`public/`、`tests/`）以及仍被 README 当作现行说明的文档（`README.md`、`PRODUCT.md`、`docs/user-manual.md`、`docs/mcp-examples.md`、`docs/superpowers/specs/2026-11-03-bugboard-prd.md`）。未改代码、未改配置、未跑会写库的命令。

每条都是可以单独修的缺陷。历史设计稿里已经过时、且没有被现行文档引用的段落不单列。

## 计数

| 类别 | 条数 |
|------|------|
| 高危 | 7 |
| 中危 | 13 |
| 低危 | 5 |
| 文档与实现不一致 | 10 |
| 合计 | 35 |

---

## 1. 高危

### H1. 状态流转先读后写，并发下后一次覆盖前一次

`transitionBug` 在事务外读状态并校验，事务里按主键更新，不带原来的状态。两个请求同时看到 `awaiting_confirm` 时，确认和打回都会写入事件，最终状态是后提交的那一次。时间线会出现两次合法流转，但单子只留一个状态。

`src/lib/services.ts` 963–979：

```ts
const bug = getBug(identity, bugId);
const result = validateTransition({ from: bug.status, /* ... */ });
const tx = getDb().transaction(() => {
  getDb()
    .prepare("UPDATE bugs SET status = ?, updated_at = ? WHERE id = ?")
    .run(result.to, t, bugId);
```

可修：在同一条 `BEGIN IMMEDIATE` 里重新读取，并用 `UPDATE ... WHERE id = ? AND status = ?`，`changes !== 1` 时整段回滚。

### H2. 走查提交没有占住会话，失败或双击会复制报障

`commitCaptureSession` 确认状态仍是 `review` 之后，在循环里逐张 `createBug`。会话要等循环结束才标成 `done`，也没有跳过已经写过 `bug_id` 的草稿。中途抛错时，前面的单已经落库，会话仍是审核中；再点一次会把已提交的草稿再建成新单。两个请求同时通过 `status !== "review"` 检查时同样各建一套。

`src/lib/captures.ts` 519–561：

```ts
if (row.status !== "review") throw new Error("这次走查已经整理完");
const bugs = [];
for (const draft of kept) {
  const bug = createBug(identity, { /* ... */ });
  // 复制截图、回写 draft.bug_id
}
getDb()
  .prepare("UPDATE capture_sessions SET status = 'done', updated_at = ? WHERE id = ?")
  .run(nowIso(), sessionId);
```

可修：事务开头 `UPDATE capture_sessions SET status = 'done' WHERE id = ? AND status = 'review'`，只有 `changes === 1` 才继续；循环只处理 `bug_id IS NULL` 的草稿。失败则整段回滚。

### H3. 报障或流转已经提交，附件失败仍对客户端报错

小组件先 `createBug` 再存文件。路由把后面的异常收成 400，单子留在库里。上报人再点一次会再出现一张单。流转接口同样是先 `transitionBug`，再逐个 `saveUploadedFile`；第二份附件写盘失败时，状态已经变了，调用方收到错误，不能把没传上的文件补进这一次流转。

`src/lib/widget.ts` 116–134：

```ts
const bug = createBug(identity, { /* ... */ });
if (input.file) {
  saveUploadedFile({ ownerType: "bug", ownerId: bug.id, /* ... */ });
}
return bug;
```

`src/app/api/bugs/[id]/transitions/route.ts` 40–49：

```ts
const { bug, eventId } = transitionBug(identity, Number(id), action, note);
for (const f of files) {
  saveUploadedFile({ ownerType: "status_event", ownerId: eventId, /* ... */ });
}
```

可修：文件先落入暂存，再在同一个事务里建单或流转并认领；任一步失败都回滚，HTTP 不返回成功主键。

### H4. 首装的「还没有用户」判断和插入不在一个事务里

空库的 `POST /api/setup` 不需要登录。`isSetupComplete()` 只数用户行。两个同时到达的请求都会看到 0，然后各插入一名 `superadmin`。局域网按 README 直接暴露 3080 时，安装窗口里可以出现两个超级管理员。

`src/lib/services.ts` 79–90：

```ts
export async function setupAdmin(username: string, password: string) {
  if (isSetupComplete()) throw new Error("系统已完成首装");
  const info = getDb()
    .prepare(`INSERT INTO users (..., role, ...) VALUES (?, ?, 'superadmin', ...)`)
    .run(username.trim(), hash, t, t);
```

`src/lib/db.ts` 575–578：

```ts
export function isSetupComplete() {
  const row = db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
  return row.c > 0;
}
```

可修：用 `BEGIN IMMEDIATE`，在事务里再数一次；或给首装加一行 `meta` 锁，插第二个人时直接失败。

### H5. 账号管理员可以签发不受项目角色约束的管理员级 Key

人类要改报障，必须是该项目 `project_members.role = 'admin'`。管理员级 API Key 不看成员表，`isProjectAdmin` 对它直接返回全部项目。创建 Key 只要求账号角色是管理员或超级管理员。因此一个不能在某项目点「接单」的账号管理员，可以新建一把管理员级 Key，再用这把 Key 接单、提交修复、领发布任务。

`src/lib/permissions.ts` 5–8：

```ts
if (identity.kind === "api_key") {
  return isAdminRole(identity.role) ? new Set(projectIds) : new Set<number>();
}
```

`src/lib/services.ts` 1497–1501：

```ts
export function createApiKey(identity: Identity, data: { name: string; role: Role; projectIds?: number[] }) {
  if (!requireAdmin(identity)) throw new Error("需要管理员权限");
```

可修：管理员级 Key 也绑定项目，并走同一套 `project_members` 判断；或者只有超级管理员能创建 `role = 'admin'` 的 Key。

### H6. 登录和小组件限流都信任调用方自己报的 IP

`clientIpFromHeaders` 先取 `X-Real-IP`，否则取 `X-Forwarded-For` 的第一段。README 的 Docker 部署是主机端口 3080 直接对局域网开放，请求不经过会覆盖这些头的代理时，调用方可以每次换一个头，绕过「每 IP 40 次登录」和「每 IP 每 10 分钟 30 次上报」。小组件入口带 `Access-Control-Allow-Origin: *`，拿到页面里的 token 后可以按 50MB 上限灌附件。两套计数都在进程内存里，重启即清零；小组件的 `hits` 也没有淘汰过期键。

`src/lib/login-throttle.ts` 50–55：

```ts
export function clientIpFromHeaders(headers: Headers) {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 80);
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
```

`src/lib/widget.ts` 8–22：

```ts
const hits = new Map<string, number[]>();
export function assertWidgetRate(token: string, ip: string) {
  const key = `${token.slice(0, 12)}:${ip}`;
  const recent = (hits.get(key) || []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= MAX_HITS) throw new Error("提交过于频繁，请稍后再试");
```

可修：只在配置了可信代理时采用转发头，否则用连接上的地址；计数改到 SQLite，并限制单 token 的全局次数，而不是只按 IP。

### H7. 改密码和重置密码都不使已发出的会话失效

会话里只存 `userId`。自己改密码、管理员重置密码都只更新 `password_hash`。禁用账号会生效，因为 `resolveSessionIdentity` 会看 `active`；已经拿走的 cookie 在改密之后仍然能登录，直到 cookie 自己过期。

`src/lib/auth.ts` 8–10 与 78–88：

```ts
export type SessionData = { userId?: number };
export async function resolveSessionIdentity(): Promise<Identity | null> {
  if (!session.userId) return null;
  const user = getUserById(session.userId);
  if (!user || !user.active) return null;
```

`src/lib/services.ts` 121–123：

```ts
getDb()
  .prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
  .run(hash, nowIso(), user.id);
```

可修：用户表加 `session_version`，改密、重置密码时加一，解析会话时比对。

---

## 2. 中危

### M1. 旧库加上项目角色时，所有成员都被写成普通用户

`ensureMemberRoles` 在缺列时把 `role` 默认成 `user`，没有把当时的账号管理员回填成项目管理员。这一列一旦加上，升级后的人类账号都不能再接单，直到有人在成员页逐个改角色。

`src/lib/db.ts` 458–462：

```ts
function ensureMemberRoles(db: Database.Database) {
  if (columnNames(db, "project_members").includes("role")) return;
  db.exec(
    "ALTER TABLE project_members ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin'))"
  );
}
```

可修：加列时把 `users.role IN ('admin','superadmin')` 的成员更新为项目 `admin`，并在 README 写明升级后要核对成员角色。

### M2. 发布超时只改分派行，变更页读不到这次失败

超时把 `agent_dispatches.status` 写成 `failed`。变更页的失败横幅只读 `project_changes` 里最新一条 `kind = 'release'`。超时不插入这条记录，所以横幅要么消失，要么继续显示更早的一次失败。页面文案写的是失败原因会显示在本页。

`src/lib/release.ts` 374–379：

```ts
const update = getDb().prepare(
  `UPDATE agent_dispatches SET status = 'failed', detail = ? WHERE id = ? AND status = 'running'`
);
for (const row of stale) update.run(STALE_RELEASE, row.id);
```

`src/lib/release.ts` 423–434 与 `src/lib/release-ui.ts` 35–36：横幅只在 `latestFailureDetail`（来自 `project_changes`）非空时出现。

可修：超时与 `finish` 的失败走同一条 `insertChange(..., result: 'failed')`。

### M3. 叫醒服务保存会话时丢掉走查的会话号

`writeSession` 读回文件时只保留 `bug:` 开头的键。走查键是 `capture:<code>:<id>`。下一次任何写入都会把其他走查会话丢掉，整理无法 `--resume`。

`scripts/wake-agent.mjs` 135–151：

```js
for (const [savedKey, savedId] of Object.entries(data)) {
  if (!/^bug:[A-Z][A-Z0-9]{1,7}:\d{1,12}$/.test(savedKey)) continue;
  // ...
}
next[key] = id;
```

可修：保留 `bug:` 和 `capture:` 两种键，并用同一套 `sessionKeyFor` 校验。

### M4. 「本机地址不能指向元数据服务」只比对了三个主机名

拦截的是字面量 `169.254.169.254`、`metadata.google.internal`、`fd00:ec2::254`。没有解析 DNS，也没有拒绝十进制、十六进制或 IPv6 映射写法。管理员把本机地址存成这类 URL 后，服务器仍会把分派 POST 发过去。

`src/lib/dispatch.ts` 218–221：

```ts
const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
if (host === "169.254.169.254" || host === "metadata.google.internal" || host === "fd00:ec2::254") {
  throw new Error("本机地址不能指向元数据服务");
}
```

可修：保存和发送前把主机解析成 IP，拒绝链路本地、云元数据网段和未解析成功的名字；发送时 `redirect: "error"`。

### M5. 每次 API Key 鉴权都写 `last_used_at` 和 `use_count`

只读接口也会拿写锁。better-sqlite3 默认最多等约 5 秒，超时后这次调用失败，即使 Key 是有效的。MCP 进站后再回环调用 REST，同一次工具调用至少写两次。

`src/lib/auth.ts` 108–112：

```ts
getDb()
  .prepare("UPDATE api_keys SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?")
  .run(nowIso(), row.id);
```

可修：使用记录改成异步批量更新，或放到独立连接并在失败时不影响本次鉴权结果。

### M6. 暂存附件只有被认领或整个项目被删时才消失

`stageUpload` 先写盘再插 `staged_uploads`。全库只有认领时的 `DELETE FROM staged_uploads WHERE id = ?`，以及删项目时顺带删文件。放弃新建报障后，行和文件一直留着。

`src/lib/staged.ts` 23–36 写入；同文件 91 行只在 `claimStagedUploads` 里按 id 删除。没有按 `created_at` 清理的路径。

可修：加一个按创建时间删除过期暂存的任务，并在删行时 `unlink`。

### M7. 流转说明和补充说明没有长度上限

标题和正文分别限制 200 和 20000。`transitionBug` 和 `addBugSupplement` 只检查说明非空（在必填时），然后整段写入 `bug_status_events.note`。一条请求可以把很大的 JSON 写进 SQLite。

`src/lib/services.ts` 991 与 1047：`note?.trim()` / `text` 直接绑定进 `INSERT`。对照 `src/lib/limits.ts` 只定义了 `BUG_TITLE_MAX` 和 `BUG_BODY_MAX`。

可修：说明复用 `BUG_BODY_MAX`，超长在写库前拒绝。

### M8. 重复添加成员时，新的项目角色被静默丢掉

`INSERT OR IGNORE` 在主键冲突时不更新 `role`，函数也不看 `changes`。接口仍返回当前成员列表，调用方以为这次指定的角色已经生效。

`src/lib/services.ts` 344–348：

```ts
getDb()
  .prepare("INSERT OR IGNORE INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)")
  .run(projectId, userId, projectRole);
```

可修：冲突时返回「已是成员」，角色变更只走 `updateMemberRole`。

### M9. 上报脚本替换宿主页面的 `console.error` / `console.warn`，并把日志随单上传

脚本在宿主页面永久包住这两个方法，不在关闭面板时恢复。最近 20 条日志放进表单的 `console` 字段，服务端写入报障正文。宿主应用打到控制台的令牌或个人信息会进台账。

`public/widget.js` 9–17：

```js
console[level] = function () {
  var text = Array.prototype.slice.call(arguments).map(String).join(" ").slice(0, 300);
  logs.push(level + ": " + text);
  if (logs.length > 20) logs.shift();
  return original.apply(console, arguments);
};
```

可修：去掉对 `console` 的替换；若要保留，只在用户点提交时附带，并在片段说明里写明会上传。

### M10. 「一分钟内同一原因只分派一次」不是原子判断

`recentlySent` 查询之后才 `INSERT`。两个同时回来的「仍有问题」都会看到没有近期记录，然后各插一条并各发一次。

`src/lib/dispatch.ts` 997–1018 与 1027–1035：先 `SELECT ... created_at >= ?`，通过后再 `INSERT INTO agent_dispatches`。

可修：用部分唯一索引或在 `BEGIN IMMEDIATE` 里先插入占位行，冲突则跳过。

### M11. 状态机默认把账号角色当成能改单

`allowedActions` 和 `validateTransition` 在调用方没传 `asAdmin` 时使用 `isAdminRole(identity.role)`。生产路径的 `transitionBug` 传的是 `isProjectAdmin`。新代码若漏传这个参数，账号管理员会重新获得全部项目的流转权。现有 `tests/state-machine.test.ts` 调用 `allowedActions(admin, ...)` 时没有第五个参数，锁住的是这套默认行为，而不是成员页上的项目角色。

`src/lib/state-machine.ts` 159 与 183：

```ts
asAdmin = isAdminRole(identity.role)
const admin = params.asAdmin ?? isAdminRole(params.identity.role);
```

可修：去掉默认值，调用方必须传入；单测改成显式 `asAdmin: false / true`。

### M12. 删除用户不清理小组件的归属人

`widget_owner_user_id` 没有外键。`deleteUser` 删人和这个人创建的 API Key，不改项目上的归属。之后匿名上报查到已删除用户，一律「上报入口已失效」，页面上的片段仍是旧 token。

`src/lib/services.ts` 583–586 只删 `api_keys` 和 `users`。`src/lib/widget.ts` 90–95 在归属用户不存在或已禁用时拒绝上报。

可修：删用户前把相关项目的 `widget_token` 和 `widget_owner_user_id` 清空，或禁止删除仍被小组件引用的用户。

### M13. 并发创建同名项目时，SQLite 的 UNIQUE 原文会回到客户端

slug 和缩写的占用检查在插入之外。两个请求都通过检查后，后一个插入抛出驱动错误。`withAuth` 没有把未知异常收成固定文案，调用方看到 `UNIQUE constraint failed: projects.slug` 一类原文，项目也没有建成。

`src/lib/services.ts` 157–167 先 `SELECT` slug 再 `INSERT`。`src/lib/http.ts` 23–31 把异常 `message` 原样放进 JSON。

可修：插入包进事务并在唯一约束冲突时换一个 slug 或返回「名称冲突」，不要把驱动错误文案传出。

---

## 3. 低危

### L1. 允许的扩展名里 `.webm` 写了两次

集合里重复的成员没有行为差异，但说明白名单是手工维护的，音频和视频的 `.webm` 容易被看成两个类型。

`src/lib/uploads.ts` 19 与 30 都是 `".webm"`。

可修：删掉重复项，扩展名只留一处，MIME 表继续按扩展名取。

### L2. `safeEqualHex` 没有调用方

API Key 用哈希等值查询，这只比较函数没有被鉴权路径使用。

`src/lib/auth.ts` 65–69 定义了 `safeEqualHex`。全库没有第二处引用。

可修：删除该函数；若要做十六进制比较，接到真正的比较点上。

### L3. 三份 shell 黑名单不一致

发布命令拒绝 `dash`、`ksh`、`csh`、`tcsh`。叫醒服务和分派配置里的命令校验没有这些名字。同一种「不能把 shell 当可执行文件」的规则，本地 agent 命令可以填 `dash`，发布命令不行。

- `src/lib/deploy-command.ts` 3–18
- `src/lib/dispatch.ts` 225
- `scripts/wake-agent.mjs` 82

可修：三处改成同一份名单，并加同一组测试。

### L4. 接口用错误文案里的子串决定 403 和 404

文案里出现「无权」或「需要管理员」就是 403，出现「不存在」就是 404，其余包括数据库错误都是 400。改一句中文就会改掉 HTTP 状态。

`src/lib/http.ts` 25–30：

```ts
const status =
  message.includes("无权") || message.includes("需要管理员")
    ? 403
    : message.includes("不存在")
      ? 404
      : 400;
```

可修：服务函数抛带 `status` 的错误，文案只负责给人看。

### L5. 附件表没有指向报障或流转的外键

`bugs` 和 `bug_status_events` 随项目删除级联。`attachments` 没有对应外键。现在靠 `deleteBug` / `deleteProject` 里手写的 `DELETE FROM attachments` 清行，再在事务外删文件。下一条删除路径若只删报障，行和磁盘文件都会留下。

`src/lib/db.ts` 106–116 的 `attachments` 定义没有 `FOREIGN KEY`。清理逻辑在 `src/lib/services.ts` 212–237 和 880–896。

可修：加上外键，或把「收集路径、删行、删文件」收成唯一的删除函数，禁止别处直接 `DELETE FROM bugs`。

---

## 4. 文档与实现不一致

### D1. README 说账号管理员不用进成员表就能接单

文档：管理员能进全部项目，不必再加为成员，并且负责接单、写修复说明、标不属实（`README.md` 17–23、83–95）。

代码：可见性和处理权是分开的。`canAccessProject` 对账号管理员返回真；`isProjectAdmin` 对人类只认 `project_members.role = 'admin'`（`src/lib/permissions.ts` 24–34）。`transitionBug` 把后者传给状态机（`src/lib/services.ts` 971）。`docs/user-manual.md` 第 16 行已经写成「处理权限仍看项目成员里的角色」，和 README 矛盾。

### D2. README 说管理后台有四页

文档：`README.md` 119–140 列出用户、API Key、提示词、数据分析。

代码：`src/app/admin/page.tsx` 26–33 有六项：数据分析、用户、API Key、分派给 Agent、行为、提示词。

### D3. README 和产品手册的主流程没有「待产品经理确认」

文档：`README.md` 65–95 的图和表从待处理、修复中直接到不属实、待补充、待发布，没有 `request_product` / `decline_product` / `accept_product`。`docs/user-manual.md` 第 6 行的链是「待处理 → 修复中 → 待发布 → 待确认 → 已确认」，没有待补充和待产品确认。

代码：`src/lib/state-machine.ts` 47–66 有这三步；`src/lib/types.ts` 22 的文案是「待产品经理确认」。

### D4. PRODUCT.md 仍是两种账号角色，并且写明不做细粒度角色

文档：`PRODUCT.md` 16–17 说管理员在全部项目里接单；第 35 行「角色仅用户 / 管理员」；第 40 行「一期不做细粒度自定义角色」。

代码：账号有 `user` / `admin` / `superadmin`（`src/lib/db.ts` 41）。项目成员另有 `user` / `admin`（`src/lib/db.ts` 73）。超级管理员才能删项目和报障（`src/lib/services.ts` 205、877）。

### D5. PRD 的状态机仍是「提交修复说明后直接待确认」

文档：`docs/superpowers/specs/2026-11-03-bugboard-prd.md` 82–94。待确认的含义是「已提交修复说明」。允许的转换是「修复中 → 待确认」，没有待发布、待补充、待产品确认、撤回修复。README 已把这条链改成先待发布。PRD 仍挂在 `README.md` 243 行的现行文档列表里。

代码：`submit_fix` 的目标是 `ready_to_release`（`src/lib/state-machine.ts` 82–86）。进入待确认的动作是 `release_fixes`（88–94 行）。

### D6. PRD 说管理员级 Key 能管用户和 Key，并且 Key 以吊销为主

文档：同一 PRD 第 63 行，管理员级 Key「外加用户/项目/成员/Key 管理」；第 44、74 行写的是吊销。

代码：`src/lib/services.ts` 1509–1510 对非人类身份抛出「仅人类管理员可创建 API Key」。`updateApiKey` 同样要求 `identity.kind === "user"`（1552–1554 行）。现行删除是物理删除；`revoked_at` 只留下来挡住修改（1569–1571 行）。README 128 行已写成物理删除。

### D7. MCP 示例的工具表少于服务器实际注册的工具

文档：`docs/mcp-examples.md` 57–66 行的表停在 `list_projects`、报障流转、`record_change` 和发布。没有产品确认、认可不属实、补充说明、走查、项目资料和 Logo。

代码：`mcp/create-server.ts` 还注册了 `request_product`（448）、`decline_product`（469）、`accept_product`（488）、`reopen_invalid`（522）、`accept_invalid`（716）、`add_supplement`（761）、`list_captures`（284）、`update_project_docs`（782）、`upload_project_logo`（840）等。

### D8. README 说报障编号的日期跟着容器时区

文档：`README.md` 235 行，`TZ`「容器时区，compose 里是 Asia/Shanghai。报障编号按这个时区取日期」。

代码：`src/lib/time.ts` 1–27 把上海固定成 UTC+8，用 `getUTC*` 取年月日，不读 `TZ`。容器改成别的时区，编号日期不会跟着变。

### D9. 产品手册把紧急发布写成当场跑完部署

文档：`docs/user-manual.md` 25 行，「管理员可对选中单触发即时发布管道（与夜间同一套流程）」。

代码：网页 `mode: "run"` 调用 `requestRunRelease`，只插入排队记录（`src/lib/release.ts` 124–152）。真正的 git 和部署在 `scripts/release-runner.mjs`。没人领队列时，选中的单不会在这次点击里上线。README 180 行的「只入队」和代码一致，和手册不一致。

### D10. 多处写「发布失败的原因会显示在变更页」，超时这条路径不会

文档：`README.md` 188 行说超过 45 分钟会记失败。`src/lib/release-ui.ts` 9–19 行告诉操作者失败原因显示在本页。

代码：见 M2。超时只更新 `agent_dispatches.detail`，不写 `project_changes`，横幅的数据源是后者。提交修复说明「调用前须已 commit 并 push」（`README.md` 85 行）也没有服务端检查，`submit_fix` 只校验状态、身份和说明（`src/lib/state-machine.ts` 82–86）。
