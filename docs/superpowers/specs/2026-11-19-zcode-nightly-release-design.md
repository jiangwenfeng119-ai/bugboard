# ZCode 夜间发布 — Design

- **日期**：2026-11-19
- **状态**：待评审
- **背景**：问答 Agent 和修复 Agent 用 Cursor。发布交给 ZCode，用来复核 Cursor 已经 push 的待发布改动。现有 `release-runner` 只做 git 同步和部署命令，成功后把该项目全部待发布推进到待确认，中间不审查、不跑测试、不做地址健康检查。

## Goal

每天 22:00 由一条绑在 Bugboard 工作区的 ZCode 定时任务，处理所有「还有待发布、并且会自动部署」的被测项目：审查、跑该项目已有的测试、能单独撤回的退回待处理并叫醒 Cursor，通过的才执行项目里已配置的发布命令并做健康检查，然后只把这一批改成待确认。结果写进该项目的变更页，并寄一封邮件到 marshal.jiang@zhaoxuntec.com。

成功标准：

1. 没有待发布，或发布方式仍是不自动部署的项目，当晚不部署、不改状态。
2. 仓库不安全、测试失败但归不到某一张、或一个提交拆不开时，整个项目不动，变更里记一条失败的定时发布。
3. 能单独撤回的没过单：撤回推送之后回到待处理，叫醒 Cursor，变更里有一条杂务。
4. 通过审查和测试、发布命令成功、验收地址健康的单，才进入待确认，变更里是一条成功的定时发布，原先的修复记录变为已上线。
5. 全部项目处理完后发一封邮件。失败和停手写在前面。没有待发布也发一封，说明任务跑过了。
6. 其他状态不被这次任务改动。ZCode 不重写修复，不代替报障人确认。

## 非目标

- 不把邮件做成 Bugboard 的产品通知。这封信由夜间任务用本机 himalaya 发出。
- 不在验收环境上重走每张报障的「请这样重测」。那是待确认之后 Cursor 用户级 Agent 的事。
- 不调用 `run_release`，不让 22:00 的 `release-runner --schedule` 再跑一遍。
- 不发明测试命令，不把缺测试当成失败。
- 不绕过项目行为里的「发布成功后推进」开关。
- 不在单元测试里真发邮件或真部署。

## 角色和任务

ZCode 是发布 Agent。Cursor 继续做问答和修复。交叉检查的含义是：ZCode 只判断已经 push 的待发布能不能上。能改仓库的唯一动作是 `git revert` 没过的那些提交。

一条定时任务，每天 22:00，按电脑本地时区。绑在 Bugboard 这个本地项目上，创建后不改绑定。权限用能在其他目录跑命令和改 git 的那一档。自动化页打开「保持唤醒」。ZCode 要开着，电脑要醒着。

任务使用已连接的管理员级 Bugboard MCP。本地仓库路径读任务工作区里的 `wake.config.json`：`projects` 用项目缩写或 slug 对绝对路径。

操作者关掉原来的 `0 22 * * * ... release-runner.mjs --schedule`。紧急发布仍可入队，但不由这条夜间任务领走。

队列按「现在还在待发布」算，不按日历只看今天的提交。昨天没发出去的，今晚还在。审查对象是这些单在 `record_change` 里挂上的提交。

## 一个项目当晚的顺序

多个项目逐个做。每个项目做完，把结果写进当夜报告草稿。全部做完再发信。中途停住时，把已经做完的项目和停住的原因发出去。

### 1. 入选

`list_projects` 取出项目。对每个项目 `list_pending_release`。没有待发布的不跑。`deployMode` 不是 `restart` 或 `ecs_deploy` 的跳过，状态不动，也不逐条写进邮件。

`list_pending_release` 今天不返回发布命令。实现时补上 `deployMode` 和 `deployCommand`，管理员可读。验收地址仍用 `list_projects` 里的 `verify_env`、`dev_url`、`test_url`、`prod_url`。

### 2. 仓库能不能动

下面任何一条成立，整个项目今晚不动：待发布保持原样，`mark_released` 记一条 `result=failed`、`trigger=scheduled`，`detail` 写原因。不撤回，不部署。

- `wake.config.json` 没有这个项目的目录，或目录不是 git 仓库
- origin 和 `github_url` 对不上
- 当前分支不是 `default_branch`
- 工作区不干净
- 和远端分叉（两边都有新提交）
- `releaseFeedback.activeStatus` 是 `queued` 或 `running`

只落后则 `git pull --ff-only`。只超前则 `git push`。已经对齐则继续。同步失败同样整项目停手。

### 3. 逐张审查，再跑现有测试

对每张待发布 `get_bug`，读修复说明和 `list_pending_release` 里还没上线的变更。

这张算没过：

- 提交和报障、修复说明对不上，或改动面明显超出这张单
- diff 里有密钥、token 或私钥

没有能对上的 commit SHA，或者一个 SHA 同时出现在「通过」和「没过」的单上：不猜、不部分撤回，整个项目按第 2 步停手。只出现在没过单上的 SHA 可以撤回。

然后跑测试。`agent_notes` 里只认单独成行、以「测试命令：」开头的那一行，整行余下的部分就是要执行的命令。没有这一行、且仓库 `package.json` 有 `test` script，就在该仓库跑 `npm test`。两处都没有：报告写「没有可跑的测试」，不因此停发。不把资料里的其他句子当成命令。

测试失败但归不到具体的没过单：整个项目停手，规则同第 2 步。

### 4. 撤回

没过、且它的 SHA 都能单独撤回：在本地从新到旧 `git revert --no-edit`。冲突则 `git revert --abort`，不推送，整个项目停手。

撤回后再跑第 3 步的同一条测试。再测失败：不推送，整个项目停手。再测通过才 `git push`。

推送成功之后：

- `record_change`，`kind=chore`，`title` 写撤回了哪张单、为什么，`commitShas` 是撤回提交的 SHA，`bugIds` 是被退回的单
- 对这些单调用 `release_return`，`note` 和邮件、变更里的原因是同一句话

全部没过时，到这里结束。不跑发布命令，不对空集合调用成功的 `mark_released`。

### 5. 发布和健康检查

还有通过的单：在该仓库把 `deployCommand` 当可执行文件运行，工作目录是仓库本身。命令不是绝对路径，或不是项目里已保存的那条，就记失败，不改用 shell。

然后请求验收地址。`verify_env` 为 dev、test、prod 时用对应 URL；空着则用 `test_url`，再没有用 `dev_url`。最多跟随一次重定向。连上并且最终状态码不是 5xx，算健康。4xx 算地址有响应，写进报告，不因此判失败。连接失败或 5xx 算不健康。没有可请求的地址，算不健康。

命令失败或不健康：`mark_released` `result=failed`、`trigger=scheduled`，`bugIds` 只含仍停在待发布的那些通过的单，`detail` 写停在哪一步。这些单保持待发布。已经退回待处理的单不再改回去。

两边都成功：`mark_released` `result=success`、`trigger=scheduled`，`headSha` 为部署时的 HEAD，`bugIds` 只含这一批通过的单，`detail` 写健康检查结果（地址和状态码）。这些单进入待确认。它们原先的修复记录变为已上线。退回单的杂务不挂进这次成功发布。

`releaseFeedback.advancesBugs` 为 false 时，成功也只记账，单留在待发布。`detail` 和邮件写明「发布后推进已关闭」。不另找办法改状态。`release_return` 不受这个开关影响。

失败记录不挂已经退回的单。那些单只出现在杂务记录和报障时间线上。

## 发布退回

新动作 `release_return`，界面文案「发布退回」。

| 动作 | 从 | 到 | 谁 | 说明 |
|------|----|----|-----|------|
| `release_return` | 待发布 | 待处理 | 管理员 | 必填。撤回已推送之后才调用 |
| `release_fixes` | 待发布 | 待确认 | 管理员 | 现有动作。本任务只经 `mark_released` 成功路径使用 |

待发布当晚只走这两条。修复中、待补充、待产品经理确认、待确认、已确认、不属实、已认可不改。

`release_return` 加入默认叫醒列表。已保存的项目：`wake_actions` 里还有 `reject_fix` 的，补上 `release_return`；列表为空的不补。

叫醒文案增加：这张是发布退回，先读进入待处理的那条说明，按说明重做。已经撤回的提交不是还在的修复。管理员提示词里写上同一条，这样人之后手动打开修复 Agent 也能看到。

## 变更页

不新加栏目。原因和邮件是同一句话。

- 发出去了：一条定时发布，上线为「成功」。标题下是健康检查结果。只挂通过的单。原先修复记录为「已上线」。
- 没发出去：一条定时发布，上线为「失败」。标题下写停在哪一步、为什么。待发布队列保留仍是待发布的单。
- 撤回：一条杂务，挂被退回的单号和撤回 SHA，上线仍是「未上线」。回到待处理只写在报障时间线。

## 邮件

全部项目处理完，用本机 himalaya 的默认账号 `zhaoxuntec` 发一封纯文本邮件。命令是 `himalaya template send`，不打开编辑器。收件人 `To: marshal.jiang@zhaoxuntec.com`。不在正文里写邮箱密码或配置原文。`From` 交给这个账号自己填。

主题：`Bugboard 夜间发布 YYYY-MM-DD`，日期用电脑本地时区。

整晚没有任何待发布：正文只有「今晚没有待发布」。

否则失败和停手在前，每条包含项目、报障编号、标题、停在哪一步、原因。原因写成白天能接着处理的话，不贴大段 diff。后面写成功的：哪些单进了待确认，验收地址的检查结果。没有待发布的项目不逐个列出。

发信失败：同一份报告留在 ZCode 会话里，并写明命令返回了什么。不因为发信失败去改报障状态。

## 提示词

实现时把下面这份放进 `src/lib/agent-prompts.ts` 的 `RELEASE_AGENT_PROMPT`。管理后台「给 Agent 的提示词」增加第三张卡片「发布 · 夜间复核」，供复制到 ZCode 定时任务。任务指令使用这份全文，不依赖当次会话里的背景。

```text
你是 Bugboard 的发布 Agent。问答和修复由 Cursor 做。你复核已经 push、状态为待发布的改动，通过后才发布。能改仓库的唯一动作是 git revert 没过的提交。不重写修复，不调用 confirm_fix、reject_fix、start_fix、submit_fix、withdraw_fix、run_release。

MCP 用已连接的管理员级 Bugboard。id 只用工具返回值。本地目录读工作区 wake.config.json 的 projects，键是项目缩写或 slug。

先 list_projects。再对每个项目 list_pending_release。没有待发布的跳过。deployMode 不是 restart 或 ecs_deploy 的跳过，不改状态。

一个项目接一个项目做。每做完一个，把结果写进当夜报告。全部做完再发邮件。你中途停住时，把已完成的结果和停住的原因发出去。

仓库任何一条不满足就整项目停手：目录不存在或不是 git；origin 与 github_url 不一致；当前分支不是 default_branch；工作区不干净；与远端分叉；releaseFeedback.activeStatus 为 queued 或 running。只落后则 git pull --ff-only。只超前则 git push。停手时 mark_released，trigger=scheduled，result=failed，detail 写原因。不传已经不在待发布的 bugIds。不撤回，不部署。

对每张待发布 get_bug。用未上线变更里的 commit SHA 看 diff。说明对不上、改动面明显超出这张单、或 diff 里有密钥、token、私钥，这张没过。没有 SHA，或一个 SHA 同时属于通过和没过的单：不猜，整个项目按上一段停手。

测试：agent_notes 里只认单独成行、以「测试命令：」开头的那一行。否则 package.json 有 test script 就在该仓库 npm test。都没有就在报告写「没有可跑的测试」，继续。测试失败且归不到没过的单：整个项目停手。

没过且 SHA 都能单独撤回：从新到旧 git revert --no-edit。冲突则 git revert --abort，不推送，整个项目停手。再跑同一条测试。仍失败则不推送，整个项目停手。通过后才 git push。然后 record_change，kind=chore，title 写撤回了哪张单和为什么，commitShas 为撤回提交，bugIds 为这些单。再 release_return，note 用同一句话。

全部没过：不跑发布命令。

还有通过的单：只运行 list_pending_release 给出的 deployCommand，cwd 为仓库。它必须是绝对路径的可执行文件。失败或不该用 shell 包起来。然后请求验收地址：verify_env 为 dev、test、prod 用对应 URL，否则 test_url，再没有 dev_url。最多跟随一次重定向。连上且最终状态码不是 5xx 算健康。4xx 写入报告，不算失败。没有地址、连不上或 5xx 算不健康。

发布命令失败或不健康：mark_released，trigger=scheduled，result=failed，bugIds 只含仍待发布的单，detail 写停在哪一步。不把已退回的单改回去。

两边成功：mark_released，trigger=scheduled，result=success，headSha 为 HEAD，bugIds 只含通过的单，detail 写地址和状态码。advancesBugs 为 false 时不要再想办法改状态，detail 写明「发布后推进已关闭，报障仍为待发布」。

邮件：全部项目结束后执行 himalaya template send，使用默认账号 zhaoxuntec，不打开编辑器。To 为 marshal.jiang@zhaoxuntec.com。Subject 为「Bugboard 夜间发布」加电脑本地日期。没有任何待发布时，正文只有「今晚没有待发布」。否则先写失败和停手：项目、报障编号、标题、停在哪一步、原因。再写成功：哪些单进入待确认，验收地址结果。不贴大段 diff，不写邮箱密码。发信失败就把同一份报告留在会话里，并写上命令输出。不要因此改报障状态。
```

## Bugboard 改动

- 状态机、MCP、叫醒原因增加 `release_return`。
- 默认叫醒列表和「行为」文案增加「发布退回，回到待处理」。已有项目按上一节的规则补这一条。
- `buildWakePrompt` 在原因是 `release_return` 时加上那段重做说明。管理员提示词写上同一规则。
- `list_pending_release` 的返回增加 `deployMode`、`deployCommand`。
- `RELEASE_AGENT_PROMPT` 与后台第三张复制卡片。

不改变更表结构。不改 `mark_released` 的推进规则。

## 测试

Bugboard 自己的自动化测试：

- `release_return` 只能从待发布到待处理。缺说明拒绝。非管理员拒绝。从其他状态调用拒绝。
- 默认叫醒包含 `release_return`。已保存且含 `reject_fix` 的项目被补上；叫醒列表为空的保持为空。叫醒文案含「发布退回」和「先读」。
- `mark_released` 成功只推进传入的、当时仍是待发布的单。失败不改状态。`advancesBugs` 为 false 时成功也不改状态。只挂在退回单上的杂务，不会被另一批成功发布标成已上线。
- 提示词文本含：不调用 `confirm_fix`、不调用 `run_release`、`git revert`、收件人 marshal.jiang@zhaoxuntec.com、`result=failed`、`今晚没有待发布`。

单元测试不发邮件，不执行部署命令。

人工验收：在 ZCode 里对这条任务点一次「立即运行」。看邮件、对应项目的变更页，以及通过单是否为待确认、退回单是否为待处理。

## 操作者要做的配置

- ZCode 自动化：每天 22:00，项目选 Bugboard 仓库，权限允许操作其他仓库，打开「保持唤醒」。指令粘贴 `RELEASE_AGENT_PROMPT`。
- 该 ZCode 项目连着管理员级 Bugboard MCP。
- 本机 himalaya 默认账号 `zhaoxuntec` 能发信。
- 关掉 22:00 的 `release-runner.mjs --schedule`。
