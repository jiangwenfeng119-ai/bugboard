# 待发布队列、项目变更账本与 Bugboard 产品说明 — Design

- **日期**：2026-11-16
- **状态**：已通过（实现计划见 `docs/superpowers/plans/2026-11-16-release-queue-and-changelog.md`）
- **背景**：修复 Agent 改完代码后，若立刻进入「待确认」，用户在未发布环境上会以为没修好；若每修一张就发生产，工作时间会反复中断（Bugboard 同机重启；EMH 上 ECS）。代码以 GitHub 为同步源，Mac Studio 与笔记本都会改同一仓库。同时需要让使用 Bugboard 的人能读到产品手册，以及 Bugboard 自身的版本与更新说明。

## Goal

把「代码已修好并推到 GitHub」和「生产已发布、可以让用户确认」拆开；用定时/紧急同一套发布管道推进状态；让 GitHub 上的变动（修 bug + 功能开发）在 Bugboard **被测项目**里可查；并在产品内提供 **Bugboard 自身**的使用手册与版本更新日志。

成功标准：

1. 修好并 push 后进入 **待发布**，用户此时不能确认。
2. 每晚固定时刻（默认 22:00）或紧急触发，按项目发布一次；成功后本批待发布 → 待确认。
3. 每个可自动化项目在本机有对应源码目录，且与 `github_url` 对齐；开工与发布前同步远端。
4. 项目页有「变更」Tab，记录该**被测项目**的代码变更与发布；MCP 可读写，笔记本 Agent 开发完也能登记。
5. 顶栏用户菜单提供 **产品手册**、**版本与更新日志**（Bugboard 产品自身，与项目「变更」Tab 不是同一回事）。

## 非目标（本设计不做）

- 不引入独立测试/预发环境（当前只有开发与生产两种形态）。
- 不做通用 CI/CD 平台；发布钩子按项目配置，先覆盖 `restart` 与 `ecs_deploy`。
- 功能变更不要求用户点「确认」；确认仍只针对报障单。
- 不自动强行解决「已 push 后的分叉」；该类冲突告警后人工处理。
- 产品手册不做可编辑的 CMS；以仓库内文档渲染为主，随 Bugboard 发版更新。
- Bugboard 自身版本日志不混进各项目的「变更」Tab。

## 环境形态

| 形态 | 例子 | 开发 | 生产 | 发布含义 |
|------|------|------|------|----------|
| A 同机 | Bugboard on Mac Studio | 与生产同一进程/目录 | 同左 | 重启/热切换当前服务 |
| B 本地+云 | EMH | 本机仓库 | 阿里云 ECS | 构建并部署到 ECS |

验收（待确认）始终对着**用户实际访问的生产环境**。Agent 自测可在本地做；用户确认必须在发布成功之后。

## 状态机

新增状态键 `ready_to_release`，界面文案 **待发布**。

```text
待处理 ──接单──▶ 修复中 ──提交修复（已 push）──▶ 待发布
                                              │
                         定时/紧急发布成功 ────┘──▶ 待确认 ──确认──▶ 已确认
                                              │         └──仍有问题──▶ 待处理
                                              │
                         发布失败 / 未发布 ───── 仍停在待发布

待发布 ──撤回修复提交──▶ 修复中
```

| 动作 | 从 | 到 | 谁 | 说明 |
|------|----|----|-----|------|
| `submit_fix` | 修复中 | **待发布** | 管理员 | 必填说明。调用前须已 commit + push；可附 commit SHA |
| `release_fixes` | 待发布 | 待确认 | 管理员/发布任务 | 随一次成功的项目发布批量执行；单张也可在「仅发布选中单」时用 |
| `withdraw_fix` | 待发布 | 修复中 | 管理员 | 必填。代码侧若需回滚另议，状态先收回 |
| `confirm_fix` / `reject_fix` | 待确认 | 已确认 / 待处理 | 原报障人 | 不变 |
| 其余动作 | — | — | — | 不属实、待补充、待产品等不变 |

原 `submit_fix`：修复中 → 待确认，**改为** 修复中 → 待发布。  
待确认的含义收窄为：**生产已包含该修复，可以重测**。

列表筛选、汇总、待办、统计：

- 管理员待办 / 芯片：增加「待发布」（项目级）。
- 用户待办：仍只看待确认 / 不属实 / 待补充；**看不到待发布**（避免未上线就去点确认）。
- 「已采纳」口径若含待确认，一并计入待发布（已修好未关单）。

## 发布管道（定时与紧急同一条）

### 触发

| 触发 | 谁 | 行为 |
|------|----|------|
| 定时 | 调度器（默认每天 22:00，项目或全局可配） | 对启用了自动发布的项目各跑一轮 |
| 紧急发布 | 管理员网页按钮或 MCP | 同一命令；可选「整项目」或「仅选中的待发布单」 |
| 标记已发布 | 管理员 | **不跑部署**；人已在外部发完时用；仍写发布记录并做状态迁移 |

禁止：人在外面发完后，靠临时提示词让 Agent「猜」该改哪些状态。状态只由 `release_fixes` / `mark_released` 推进。

### 每一轮步骤（按项目）

1. **工作区健康检查**（见下节）；失败则整轮中止并告警。
2. **Git 同步**（见同步策略）；失败则中止。
3. 执行发布钩子：`restart` 或 `ecs_deploy`（`mark_released` 跳过本步）。
4. 成功则：
   - 写入一条 `kind=release` 变更记录（触发方式、SHA、包含的 bug、结果）。
   - 将范围内 `ready_to_release` → `awaiting_confirm`（`release_fixes`）。
   - 将该批相关的未关联 release 的 change 记录挂上 `released_in`。
5. 失败则：状态不动；写失败的 release 记录；告警。

### 项目发布配置（建议挂在项目自动化配置 / wake 侧）

| 字段 | 含义 |
|------|------|
| `deploy.mode` | `restart` \| `ecs_deploy` \| `none` |
| `deploy.command` 或脚本路径 | 实际执行命令（可选） |
| `release.schedule` | 如 `22:00`；空则不参加定时 |
| `workspace` | 已由 wake.config 的项目缩写 → 绝对路径提供 |

`none`：只允许「标记已发布」，不自动部署。

## 工作区与 GitHub 同步

### 原则

**GitHub 是代码唯一真相源。** Mac Studio（修复/发布）与笔记本（功能开发）都通过 push/pull 汇合。

### 每个可自动化项目必须具备

| 项 | 要求 |
|----|------|
| `github_url`、`default_branch` | 项目资料必填 |
| 本机目录 | `wake.config.json` 的 `projects[slug]` → 绝对路径 |
| 目录内容 | 存在、是 git 仓库、`origin` 与 `github_url` 一致 |
| 发布形态 | `restart` / `ecs_deploy` / `none` 已配置 |

管理后台提供「工作区健康检查」。不通过则：**禁止自动修复与自动发布**。

目录缺失时：若有 `github_url`，可自动 `git clone` 到约定根目录（如 `~/Apps/<slug>`）并写回 wake 映射；无 `github_url` 则该项目不进入自动化。

### 何时同步

1. 修复 Agent 开工前（每张或每批）
2. 笔记本 Agent 功能开发开工前
3. 定时/紧急发布前
4. （可选）定时只检查不发布，看板提示「远端有未拉取更新」

### 同步策略（已拍板）

```text
git fetch origin
```

| 本地情况 | 动作 |
|----------|------|
| 干净且落后远端 | `pull --ff-only` |
| 干净且超前远端（有未推送？见下） | 先 `push`，再继续 |
| 有**尚未 push**的本地提交，且远端超前 | 允许 `pull --rebase`，再 push |
| 本地提交**已经 push**后又与远端分叉 | **中止**，告警，人工处理 |
| 工作区有未提交改动 | **中止**，告警 |

**Rebase 说明（给执行方）**：rebase 是把本地未推送的提交「挪」到最新远端提交之后，历史更直。只用于尚未 push 的提交；已 push 的提交禁止自动 rebase，以免改写共享历史。

### 修好即推送（已拍板）

修复 Agent 每张（或约定的原子改动）修完并自测通过后：

1. `git commit`（说明带上报障 public id）
2. `git push`
3. Bugboard：`submit_fix` → 待发布；并 `record_change(kind=fix, bug_ids=…, shas=…)`

生产发布仍等到夜间或紧急，不在此时重启/上云。

## 项目变更账本

### 为何要独立账本

报障状态机只管「这张单好没好」。笔记本上的功能开发往往没有报障单，但仍需在 Bugboard 可见。因此项目级 **变更记录** 与 bug 状态并行。

### UI：项目「变更」Tab

位置：项目页顶栏，与「报障 / 走查 / 汇总 / 成员」并列，放在 **成员之后**（报障 · 走查 · 汇总 · 成员 · **变更**）。

文案：**变更**。

内容：

- 默认一个时间倒序列表，变更与发布混排；可用筛选：全部 / 代码变更 / 发布。
- 每行：时间、kind、标题、actor、短 SHA（链到 GitHub commit）、关联报障、是否已随某次发布上线。
- 发布行：成功/失败、触发方式（定时 / 紧急 / 外部标记）、包含的待发布单数量与列表。
- 管理员可从本 Tab 或报障列表触发「立即发布」「标记已发布」。

谁可见：与项目成员可见性一致；写操作仅管理员（含管理员级 Key）。

### 数据模型

单表 `project_changes`（发布也是其中一行，`kind=release`）：

| 字段 | 说明 |
|------|------|
| id | 主键 |
| project_id | 项目 |
| kind | `fix` \| `feature` \| `chore` \| `release` |
| title | 短标题 |
| summary | 可选长说明（Markdown） |
| commit_shas | 文本/JSON，一个或多个 SHA；release 行至少含 head SHA |
| branch | 默认 default_branch |
| bug_ids | 可选；release 行为本批推进的单 |
| release_change_id | 可选；非 release 行在上线后指向对应 release 行的 id |
| trigger | 仅 release：`scheduled` \| `manual` \| `external` |
| result | 仅 release：`success` \| `failed` |
| detail | 可选；失败原因或日志摘要 |
| actor_type / actor_id | user 或 api_key |
| created_at | |

## MCP 与 Agent / Skill

### 工具（在现有 fixer/qa 能力上扩展）

| 工具 | 角色 | 作用 |
|------|------|------|
| `submit_fix` | 管理员级 | 语义改为 → 待发布；note 必填；建议传 `commitShas` |
| `record_change` | 管理员级（笔记本功能开发也用管理员级或专用 Key） | push 后登记变更；kind/title/shas/bug_ids |
| `list_changes` | 可见项目的 Key | 分页列出变更/发布 |
| `list_bugs` | 增加 `status=ready_to_release` | |
| `list_pending_release` | 管理员级 | 某项目待发布单 + 未挂 release 的变更摘要 |
| `run_release` | 管理员级 | 触发与夜间相同的发布管道（可带 bugIds 过滤） |
| `mark_released` | 管理员级 | 外部已发完；只写记录 + 状态迁移 |
| `withdraw_fix` | 管理员级 | 从待发布撤回修复中 |

用户级 Key：仍不能发布；可 `list_changes` 只读（若产品希望对用户隐藏实现细节，可仅管理员可见——**默认：成员只读可见，与 Tab 一致**）。

### 提示词 / Skill 更新要点

**修复 Agent（Mac Studio）**

1. 开工前 Git 同步（ff-only；未 push 才 rebase）。
2. 修 → 自测 → commit → push。
3. `submit_fix`（待发布）+ `record_change(kind=fix)`。
4. 不调用生产发布，除非人明确要求紧急 `run_release`。

**笔记本功能开发 Agent**

1. 开工前同样同步。
2. 开发 → 自测 → commit → push。
3. `record_change(kind=feature)`（无 bug 也可）。
4. 默认不发生产。

**发布 Agent / 定时任务**

1. 同步 → 钩子发布 → 成功则状态批量待确认 + 写 release 记录。
2. 失败保留待发布并告警。

**验收 Agent**

1. 只处理 `awaiting_confirm`。
2. 打开生产环境地址重测；通过 `confirm_fix`，否则 `reject_fix`。

## 端到端主路径

```text
用户/测试 Agent 建单
        │
        ▼
修复 Agent：sync → 修 → commit+push → 待发布 + record_change(fix)
        │
        │  （白天可并行：笔记本 sync → 功能 → push → record_change(feature)）
        ▼
22:00 / 紧急：sync → 发布生产 → release 记录 → 待发布→待确认
        │
        ▼
验收 Agent / 用户：生产环境确认或打回
```

## 错误与边界

| 情况 | 行为 |
|------|------|
| 未 push 就 submit_fix | 校验失败或 Agent 规范禁止；以「必须带可得的 remote SHA」为佳 |
| 发布中服务不可用 | 预期内短窗口；定时放在非工作时间降低影响 |
| 发布失败 | 状态保持待发布；UI/通知可见 |
| 紧急只发部分单 | 仅选中 ID 迁移；其余待发布留待下次 |
| 已确认后的回归 | 仍按现规则新开单 |
| 分叉且已 push | 自动化停止；变更 Tab/告警提示人工 |

## Bugboard 产品手册与自身版本日志

与「项目 → 变更」区分开：

| | 项目「变更」Tab | 用户菜单里的手册 / 版本 |
|--|----------------|------------------------|
| 对象 | 被测项目（如 EMH）在 GitHub 上的改动与发布 | **Bugboard 这个报障系统本身** |
| 谁写 | 修复/开发 Agent 经 MCP `record_change`，发布任务写 release | 产品随发版维护的文档（手册 + changelog） |
| 谁看 | 该项目成员 | 所有已登录用户（用户与管理员） |

### 入口（已拍板位置）

顶栏右侧用户菜单（`AppShell` 头像下拉），在「修改密码」之上增加两项，分隔线仍在账号操作与「退出」之间：

```text
产品手册
版本与更新日志
────────
修改密码
────────
退出
```

管理后台页同一套 `AppShell` 用户菜单，入口一致，不单独只给超级管理员。

### 产品手册

- 路由建议：`/help` 或 `/docs/manual`（实现时二选一，默认 `/help`）。
- 内容：Bugboard 功能介绍；**用户**怎么提报、确认、打回、补充、认可不属实；**管理员**怎么建项目/成员、分拣、接单、API Key、分派 Agent、（本设计落地后的）待发布与夜间发布、项目变更 Tab。
- 来源：仓库内 Markdown（可新建 `docs/user-manual.md`，或从 README / PRODUCT 抽面向终端用户的一版）；应用内渲染，不要外链到未部署的裸文件。
- 手册随本设计新增概念更新：待发布、变更 Tab、发布窗口等写进对应章节。

### 版本与更新日志

- 路由建议：`/help/changelog` 或与手册同页锚点；默认独立页 `/changelog`。
- 页眉展示当前运行版本（读 `package.json` version，或构建时注入的版本号）。
- 正文：Bugboard 产品更新日志（Markdown，如 `CHANGELOG.md`），按版本倒序：新增、修复、变更。
- 与项目变更账本、GitHub 同步管道无关；Bugboard 自己发版时由维护者更新该文件。

### 非目标补充

- 不在此菜单做「检查更新 / 在线升级」。
- 不把各被测项目的 `project_changes` 汇总进这份产品 changelog。

## 实现分期（供后续 plan 拆任务）

1. **状态**：`ready_to_release`、改 `submit_fix`、`release_fixes` / `withdraw_fix`、列表汇总待办、提示词。
2. **变更账本**：表 + 项目「变更」Tab + `record_change` / `list_changes`。
3. **工作区健康检查 + Git 同步**封装（供 wake/发布脚本与文档化 skill 复用）。
4. **发布管道**：定时调度、紧急按钮、`run_release` / `mark_released`、按项目钩子。
5. **验收侧**：确保只验待确认；文档与 MCP smoke 更新。
6. **产品内说明**：用户菜单入口、产品手册页、版本与更新日志页（含当前版本号）。

## 已拍板决议

1. 采用「待发布」正式状态（方案 1），不采用「卡在修复中」或「待确认加锁」。
2. 发布节奏默认 Agent/调度攒批（夜间），紧急可插队；插队与定时同一管道。
3. 修好必须 commit + push；发布与 push 分离。
4. 笔记本开发开工前也必须先同步远端。
5. GitHub 变动通过变更账本落到 Bugboard；MCP + skill 同步更新。
6. Rebase 仅允许用于尚未 push 的本地提交；已 push 分叉则中止。
7. 项目页增加「变更」Tab，展示**被测项目**的变更与发布记录。
8. 顶栏用户菜单增加「产品手册」「版本与更新日志」，面向所有登录用户，描述 Bugboard 产品自身。
