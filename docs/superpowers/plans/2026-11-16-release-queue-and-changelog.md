# 待发布队列、项目变更账本与产品说明 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「修好已 push」与「生产可确认」拆开（待发布 → 发布后待确认），为被测项目建立变更/发布账本与 MCP，并加上 Bugboard 自身的产品手册与版本日志入口。

**Architecture:** 状态机增加 `ready_to_release`；`submit_fix` 只进待发布；发布成功（或 `mark_released`）批量进 `awaiting_confirm`。单表 `project_changes` 记录 fix/feature/chore/release。本机 Git 同步与部署由 wake 侧 `release-runner` 执行，Bugboard 负责状态、账本与调度触发。产品手册/changelog 为静态 Markdown + `Prose` 渲染，入口在 `AppShell` 用户菜单。

**Tech Stack:** Next.js App Router、better-sqlite3、Vitest、MCP (`mcp/create-server.ts`)、wake (`scripts/wake-agent.mjs`)、现有 `Prose` Markdown 子集。

**Spec:** `docs/superpowers/specs/2026-11-16-release-queue-and-changelog-design.md`

## Global Constraints

- 用户待办**不包含**待发布；管理员项目芯片/待办包含待发布
- 已采纳口径：`fixing + ready_to_release + awaiting_confirm + confirmed`
- Rebase 仅允许**尚未 push**的本地提交；已 push 分叉则中止自动化
- 修好必须 commit + push 后再 `submit_fix`；生产发布与 push 分离
- 项目「变更」Tab ≠ 用户菜单「版本与更新日志」
- 中文 UI 文案与现有状态徽章风格一致；新徽章类名 `bb-badge-ready_to_release`
- 测试用 Vitest：`npm test`；改 MCP 后视情况跑 `npm run mcp:smoke`

## File map

| 文件 | 职责 |
|------|------|
| `src/lib/types.ts` | `BugStatus`、`STATUS_LABEL`、变更相关类型 |
| `src/lib/state-machine.ts` | `submit_fix` 目标、`release_fixes`、`withdraw_fix` from 待发布 |
| `src/lib/db.ts` | `project_changes` 表；`project_dispatch` 发布配置列 |
| `src/lib/services.ts` | 统计/待办/采纳；`recordChange` / `listChanges` / `markReleased` / `runRelease` 编排入口 |
| `src/lib/project-changes.ts` | 变更账本 CRUD（新建，避免 `services.ts` 再膨胀） |
| `src/lib/release.ts` | 发布编排：选单、写 release 行、批量 `release_fixes`、挂 `release_change_id` |
| `src/lib/workspace-git.ts` | 纯函数：解析 git 状态决策（ff / rebase / abort）；可单测 |
| `src/lib/agent-prompts.ts` | 修复/验收提示词：待发布、commit+push、`record_change` |
| `src/app/globals.css` | 待发布徽章色 |
| `src/components/StatusBadge.tsx` | 随 `STATUS_LABEL` 自动支持 |
| `src/components/AppShell.tsx` | 菜单：产品手册、版本与更新日志 |
| `src/app/help/page.tsx` | 产品手册 |
| `src/app/changelog/page.tsx` | 版本与更新日志 |
| `docs/user-manual.md` | 手册正文 |
| `CHANGELOG.md` | Bugboard 产品 changelog |
| `src/app/projects/[id]/ProjectTabs.tsx` | 「变更」Tab（全员可见） |
| `src/app/projects/[id]/changes/page.tsx` | 变更列表 + 管理员发布按钮 |
| `src/app/api/projects/[id]/changes/route.ts` | GET list / POST record |
| `src/app/api/projects/[id]/release/route.ts` | POST run / mark |
| `mcp/create-server.ts` | 新工具与 `submit_fix` 文案 |
| `scripts/release-runner.mjs` | 本机：健康检查、git 同步、执行 deploy、回调完成 |
| `wake.config.json.example` | 可选 `deploy` 字段说明 |
| `tests/state-machine.test.ts` 等 | 对应单测 |
| `README.md` | 状态图与发布说明 |

---

### Task 1: 状态机 — `ready_to_release` + `release_fixes`

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/state-machine.ts`
- Modify: `src/app/globals.css`（在 `.bb-badge-awaiting_confirm` 旁增加待发布色）
- Test: `tests/state-machine.test.ts`

**Interfaces:**
- Produces: `BugStatus` 含 `"ready_to_release"`；`TransitionAction` 含 `"release_fixes"`；`STATUS_LABEL.ready_to_release = "待发布"`；`ACTION_LABEL.release_fixes = "发布后待确认"`
- Produces: `submit_fix`: `fixing` → `ready_to_release`；`withdraw_fix`: `ready_to_release` → `fixing`；`release_fixes`: `ready_to_release` → `awaiting_confirm`（who: admin, noteRequired: false）

- [ ] **Step 1: 写失败单测**

在 `tests/state-machine.test.ts` 增加：

```ts
it("submit_fix goes to ready_to_release; release_fixes then awaiting_confirm", () => {
  const submitted = validateTransition({
    action: "submit_fix",
    from: "fixing",
    identity: admin,
    reporterType: "user",
    reporterId: 2,
    note: "已修好",
  });
  expect(submitted.ok && submitted.to).toBe("ready_to_release");

  const released = validateTransition({
    action: "release_fixes",
    from: "ready_to_release",
    identity: admin,
    reporterType: "user",
    reporterId: 2,
  });
  expect(released.ok && released.to).toBe("awaiting_confirm");

  expect(allowedActions(admin, "ready_to_release", "user", 2)).toEqual(
    expect.arrayContaining(["release_fixes", "withdraw_fix"])
  );
  expect(allowedActions(reporter, "ready_to_release", "user", 2)).toEqual([]);
});
```

- [ ] **Step 2: 跑测确认失败**

Run: `npx vitest run tests/state-machine.test.ts`
Expected: FAIL（仍进 `awaiting_confirm` 或无 `release_fixes`）

- [ ] **Step 3: 改类型与状态机**

`types.ts`：加入 `"ready_to_release"` 与文案「待发布」。  
`state-machine.ts`：改 `submit_fix.to`；扩展 `withdraw_fix.from`；新增 `release_fixes`；`ACTION_LABEL` 补齐。  
`globals.css`：为 `.bb-badge-ready_to_release` 选与「待确认」可区分的色（勿用紫系默认 AI 风）。

- [ ] **Step 4: 跑测通过**

Run: `npx vitest run tests/state-machine.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/state-machine.ts src/app/globals.css tests/state-machine.test.ts
git commit -m "$(cat <<'EOF'
feat: add ready_to_release status between fix and confirm

EOF
)"
```

---

### Task 2: 服务层统计、待办、流转集成

**Files:**
- Modify: `src/lib/services.ts`（`BUG_STATUSES`、`emptyStatusCounts`、`countAdopted`、inbox 查询、sort CASE、`transitionBug` 调用方无需改签名）
- Modify: `src/lib/bug-list-query.ts`（status 白名单）
- Test: `tests/services.test.ts`（改现有「submit → awaiting_confirm」断言为 `ready_to_release`，并补 `release_fixes` → `awaiting_confirm`）

**Interfaces:**
- Consumes: Task 1 transitions
- Produces: `emptyStatusCounts()` 含 `ready_to_release: 0`；`countAdopted` 含待发布；管理员 inbox/芯片计待发布；用户 inbox 不计

- [ ] **Step 1: 更新/新增 services 测试**

关键断言示例：

```ts
services.transitionBug(adminId, bug.id, "submit_fix", "已修");
expect(services.getBug(adminId, bug.id).status).toBe("ready_to_release");
services.transitionBug(adminId, bug.id, "release_fixes");
expect(services.getBug(adminId, bug.id).status).toBe("awaiting_confirm");
```

用户 inbox  fixtures：一张 `ready_to_release` **不出现**在用户待办；管理员项目芯片 `readyToRelease`（或并入现有计数字段，命名与 UI 一致）> 0。

- [ ] **Step 2: 跑测失败**

Run: `npx vitest run tests/services.test.ts`

- [ ] **Step 3: 实现计数与 inbox**

在所有 `IN (...)` / `CASE WHEN status` / `Record<BugStatus, number>` 处补上 `ready_to_release`。  
`countAdopted`：

```ts
return (
  counts.fixing +
  counts.ready_to_release +
  counts.awaiting_confirm +
  counts.confirmed
);
```

用户侧 awaiting 计数查询**不要**加入 `ready_to_release`。

- [ ] **Step 4: 全量测试**

Run: `npm test`  
Expected: PASS（修断掉的旧断言）

- [ ] **Step 5: Commit**

```bash
git add src/lib/services.ts src/lib/bug-list-query.ts tests/services.test.ts
git commit -m "$(cat <<'EOF'
feat: wire ready_to_release through stats and inbox

EOF
)"
```

---

### Task 3: 变更账本表 + `project-changes` / `release` 服务

**Files:**
- Modify: `src/lib/db.ts`（SCHEMA + migrate）
- Create: `src/lib/project-changes.ts`
- Create: `src/lib/release.ts`
- Create: `tests/project-changes.test.ts`
- Modify: `src/lib/types.ts`（可选导出 `ProjectChangeKind` 等）

**Interfaces:**
- Produces:

```ts
export type ProjectChangeKind = "fix" | "feature" | "chore" | "release";
export type ReleaseTrigger = "scheduled" | "manual" | "external";

export function recordChange(
  identity: Identity,
  projectId: number,
  input: {
    kind: Exclude<ProjectChangeKind, "release">;
    title: string;
    summary?: string;
    commitShas: string[];
    branch?: string;
    bugIds?: number[];
  }
): { change: ProjectChangeRow };

export function listChanges(
  identity: Identity,
  projectId: number,
  opts?: { kind?: ProjectChangeKind | "code"; limit?: number; offset?: number }
): { changes: ProjectChangeRow[]; total: number };

/** 不跑部署：写 release 行 + 批量 release_fixes + 挂 release_change_id */
export function markReleased(
  identity: Identity,
  projectId: number,
  input: {
    trigger: ReleaseTrigger;
    headSha?: string;
    bugIds?: number[]; // 默认该项目全部 ready_to_release
    detail?: string;
    result?: "success" | "failed";
  }
): { release: ProjectChangeRow; bugIds: number[] };
```

表 `project_changes` 列与 spec 一致：`kind, title, summary, commit_shas, branch, bug_ids, release_change_id, trigger, result, detail, actor_type, actor_id, created_at`。`commit_shas` / `bug_ids` 存 JSON 文本。

- [ ] **Step 1: 失败测试** — `recordChange` + `markReleased` 成功路径把两张待发布单推到待确认，并写 `kind=release` 行；失败 `result=failed` 时状态不变。

- [ ] **Step 2: 建表迁移 + 实现 `project-changes.ts` / `release.ts`**

`markReleased` 成功路径伪代码：

```ts
const ids = input.bugIds ?? listReadyToReleaseIds(projectId);
const releaseId = insertChange({ kind: "release", trigger: input.trigger, result: "success", ... });
for (const id of ids) {
  transitionBug(identity, id, "release_fixes", "已随发布进入待确认");
}
linkChangesToRelease(projectId, ids, releaseId);
```

- [ ] **Step 3: `npm test` PASS**

- [ ] **Step 4: Commit**

```bash
git add src/lib/db.ts src/lib/project-changes.ts src/lib/release.ts src/lib/types.ts tests/project-changes.test.ts
git commit -m "$(cat <<'EOF'
feat: add project_changes ledger and markReleased

EOF
)"
```

---

### Task 4: REST + MCP 工具

**Files:**
- Create: `src/app/api/projects/[id]/changes/route.ts`
- Create: `src/app/api/projects/[id]/release/route.ts`
- Modify: `mcp/create-server.ts`
- Modify: `src/lib/agent-prompts.ts`
- Modify: `tests/agent-prompts.test.ts`

**Interfaces:**
- `GET /api/projects/:id/changes?kind=&limit=&offset=`
- `POST /api/projects/:id/changes` body: recordChange input（管理员）
- `POST /api/projects/:id/release` body: `{ mode: "mark" | "run", trigger, bugIds?, headSha?, detail? }`  
  - `mark` → 本 Task 内完整实现 `markReleased`  
  - `run` → 本 Task 先实现为：校验管理员后调用 `requestRunRelease` 占位（写入一条 `agent_dispatches` 或返回 `{ queued: true }`）；**真正的 git/部署在 Task 6 接到 runner**。MCP 工具名本 Task 全部注册：`run_release` 走同一 API。
- MCP: `record_change`, `list_changes`, `list_pending_release`, `run_release`, `mark_released`；`list_bugs` status 文案含待发布；`submit_fix` 描述改为「→ 待发布」

- [ ] **Step 1: 实现 API routes（鉴权同现有 project 路由）；`mode=mark` 端到端可用**

- [ ] **Step 2: MCP 工具** — 与现有 `transition` 风格一致，经 REST 调用；`mark_released` 可测，`run_release` 至少返回已入队。

- [ ] **Step 3: 更新 `ADMIN_AGENT_PROMPT` / `USER_AGENT_PROMPT`**

修复 Agent 要点：commit+push → `submit_fix` → `record_change(kind=fix)`；默认不 `run_release`。  
验收 Agent：只处理 `awaiting_confirm`；不要对待发布确认。

- [ ] **Step 4: `npx vitest run tests/agent-prompts.test.ts` + 手工或 smoke 确认工具列表**

- [ ] **Step 5: Commit**

```bash
git add src/app/api/projects mcp/create-server.ts src/lib/agent-prompts.ts tests/agent-prompts.test.ts
git commit -m "$(cat <<'EOF'
feat: expose changes and release via API and MCP

EOF
)"
```

---

### Task 5: 项目「变更」Tab UI

**Files:**
- Modify: `src/app/projects/[id]/ProjectTabs.tsx`
- Create: `src/app/projects/[id]/changes/page.tsx`
- Create: `src/app/projects/[id]/changes/ChangesPanel.tsx`（客户端：筛选、发布按钮）
- Modify: `src/components/Icons.tsx`（若需新图标；可复用现有）

**UI 规则：**
- Tab 文案「变更」，在「成员」之后；**所有能进项目的人可见**（成员 Tab 仍仅管理员）
- 列表：时间、kind、标题、actor、短 SHA（有 `github_url` 则链到 commit）、关联报障、是否已上线
- 筛选：全部 / 代码变更（fix|feature|chore）/ 发布
- 管理员：按钮「立即发布」（`mode: "run"`）、「标记已发布」（`mode: "mark"`）；可选勾选待发布单

- [ ] **Step 1: Tab + 服务端 page 拉 `listChanges`**

- [ ] **Step 2: ChangesPanel 交互与空态**

- [ ] **Step 3: 浏览器点进 `/projects/{id}/changes` 目视**（或组件无障碍 smoke）

- [ ] **Step 4: Commit**

```bash
git add src/app/projects/[id]/ProjectTabs.tsx src/app/projects/[id]/changes src/components/Icons.tsx
git commit -m "$(cat <<'EOF'
feat: add project Changes tab for ledger and release actions

EOF
)"
```

---

### Task 6: Git 决策库 + release-runner + 发布配置

**Files:**
- Create: `src/lib/workspace-git.ts` + `tests/workspace-git.test.ts`
- Create: `scripts/release-runner.mjs`
- Modify: `src/lib/db.ts` / dispatch 读写：`deploy_mode`, `deploy_command`, `release_schedule`
- Modify: `src/lib/release.ts`：`requestRunRelease` 叫醒 runner（复用 project_dispatch.webhook 或独立 release endpoint on wake）
- Modify: `wake.config.json.example`、`scripts/wake-agent.mjs`（或 runner 独立 listen）
- Modify: 管理后台分派配置 UI（最小：三个字段）

**Interfaces:**
- `workspace-git.ts` 纯函数：

```ts
export type GitSyncPlan =
  | { action: "ff_pull" }
  | { action: "push" }
  | { action: "rebase_pull" }
  | { action: "abort"; reason: string };

export function planGitSync(input: {
  dirty: boolean;
  ahead: number;
  behind: number;
  remoteContainsLocalHead: boolean; // 本地 tip 是否已在 origin 上
}): GitSyncPlan;
```

规则对齐 spec：dirty → abort；behind&&ahead==0 → ff_pull；ahead&&behind==0 → push；ahead&&behind&&!remoteContainsLocalHead → rebase_pull；ahead&&behind&&remoteContainsLocalHead → abort（已 push 分叉）。

- Runner 步骤：健康检查（路径存在、是 git、origin 匹配）→ 按 plan 执行 → `deploy_mode`：`restart` 跑 `deploy_command`；`ecs_deploy` 跑命令；`none` 跳过 → 回调 `POST .../release` `mode: mark` 或内部 complete API。

- 定时：可用 `launchd`/系统 cron 调 `node scripts/release-runner.mjs --schedule`，或 Bugboard 进程内按 `release_schedule` 扫（优先 **外部 cron + runner**，避免 Docker 内无工作区）。在 README 写清 Mac Studio 示例：`22:00` cron。

- [ ] **Step 1: `workspace-git` 单测全部分支**

- [ ] **Step 2: runner 脚本 + 配置字段 + 最小管理 UI**

- [ ] **Step 3: 文档：`wake.config.json.example` + README 夜间发布一节**

- [ ] **Step 4: Commit**

```bash
git add src/lib/workspace-git.ts tests/workspace-git.test.ts scripts/release-runner.mjs src/lib/db.ts src/lib/release.ts scripts/wake-agent.mjs wake.config.json.example README.md src/app/admin
git commit -m "$(cat <<'EOF'
feat: add git sync planner and host release runner

EOF
)"
```

---

### Task 7: Bugboard 产品手册 + 版本日志

**Files:**
- Create: `docs/user-manual.md`
- Create: `CHANGELOG.md`（至少含 `0.1.0` 与本功能预告条目）
- Create: `src/app/help/page.tsx`
- Create: `src/app/changelog/page.tsx`
- Create: `src/lib/product-docs.ts`（`fs.readFileSync` 读仓库根/docs 下 md；导出 `appVersion` from `package.json`）
- Modify: `src/components/AppShell.tsx`

**菜单顺序（已拍板）：**

```text
产品手册 → /help
版本与更新日志 → /changelog
────────
修改密码 → /account
────────
退出
```

- 页面用现有 `Prose` 渲染；changelog 页眉显示 `package.json` 的 `version`。
- 手册章节至少：用户怎么用、管理员怎么用、待发布与夜间发布、项目变更 Tab（与产品 changelog 的区别一句说清）。

- [ ] **Step 1: 写 `docs/user-manual.md` 与 `CHANGELOG.md` 初稿**

- [ ] **Step 2: `product-docs.ts` + 两页 + AppShell 链接**

- [ ] **Step 3: 登录后点菜单确认两页可打开**

- [ ] **Step 4: Commit**

```bash
git add docs/user-manual.md CHANGELOG.md src/lib/product-docs.ts src/app/help src/app/changelog src/components/AppShell.tsx
git commit -m "$(cat <<'EOF'
feat: add in-app product manual and changelog

EOF
)"
```

---

### Task 8: README / 过滤器 UI / 收尾回归

**Files:**
- Modify: `README.md`（状态图插入待发布；发布与变更说明）
- Modify: `src/app/projects/[id]/bugs/BugFilters.tsx`（status 选项加待发布）
- Modify: 任何写死状态列表的 UI（汇总图例、EmptyState 文案若有）
- Modify: `docs/mcp-examples.md`（新工具一例）

- [ ] **Step 1: 补齐过滤器与 README 状态图**

```text
待处理 → 修复中 → 待发布 → 待确认 → 已确认
```

- [ ] **Step 2: `npm test` 全绿**

- [ ] **Step 3: Commit**

```bash
git add README.md src/app/projects docs/mcp-examples.md
git commit -m "$(cat <<'EOF'
docs: document release queue and update bug filters

EOF
)"
```

---

## Spec coverage checklist

| Spec 项 | Task |
|---------|------|
| `ready_to_release` / `submit_fix` / `release_fixes` / `withdraw_fix` | 1–2 |
| 用户待办不含待发布；采纳含待发布 | 2 |
| `project_changes` + 变更 Tab | 3, 5 |
| MCP record/list/pending/run/mark + 提示词 | 4 |
| Git 同步策略与 rebase 边界 | 6 |
| 定时/紧急同一管道；mark vs run | 3, 5, 6 |
| 工作区健康检查 + deploy modes | 6 |
| 产品手册 + 版本日志菜单 | 7 |
| README / 验收只对生产待确认 | 4, 8 |

## 建议执行方式

本计划跨状态机、账本、本机 runner、产品文档四块；可用 **subagent-driven-development** 按 Task 1→8 顺序推进。Task 6 依赖本机路径，可在 Task 3–5 用 `mark_released` 先打通闭环后再接 runner。
