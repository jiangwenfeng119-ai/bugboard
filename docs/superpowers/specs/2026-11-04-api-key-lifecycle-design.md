# API Key 生命周期增强 — Design

## Goal

管理后台 API Key 列表展示绑定项目；支持编辑（名称/角色/绑定项目/重新生成明文）、可恢复禁用、不可恢复吊销、物理删除。

## Status model

| 状态 | 条件 | 鉴权 |
|------|------|------|
| 有效 | `disabled_at` 与 `revoked_at` 均为 null | 允许 |
| 已禁用 | `disabled_at` 非空且未吊销 | 拒绝 |
| 已吊销 | `revoked_at` 非空（优先于禁用） | 拒绝 |

删除：物理删除行；`api_key_projects` CASCADE。

## Operations by status

| 状态 | 操作 |
|------|------|
| 有效 | 编辑、重新生成、禁用、吊销、删除 |
| 已禁用 | 编辑、启用、吊销、删除（不可重新生成） |
| 已吊销 | 仅删除 |

吊销 / 删除需 confirm。

## Edit rules

- 可改：`name`、`role`、`projectIds`
- 用户级必须 ≥1 个绑定项目；改为管理员级时清空绑定
- 重新生成：仅「有效」；新明文一次展示；旧 hash 立即失效
- 明文 Key 不可读回

## UI

表格列：名称 | 前缀 | 角色 | **绑定项目** | 最近使用 | 状态 | 操作

- 绑定项目：用户级用 `、` 连接项目名；管理员级或空 → `—`
- 「编辑」在行下展开表单：名称、角色、绑定勾选；保存 / 重新生成 Key / 取消
- 操作按钮按状态显隐；禁用/启用对齐用户表模式

## API（管理员）

- `PATCH /api/api-keys/[id]` — body 可选字段：
  - `name?: string`
  - `role?: "user" | "admin"`
  - `projectIds?: number[]`
  - `disabled?: boolean` — 可恢复禁用/启用；已吊销不可改
  - `regenerate?: boolean` — 成功时返回 `{ rawKey, prefix }`
  - `revoke?: boolean` — 设 `revoked_at`（不可恢复）
- `DELETE /api/api-keys/[id]` — **物理删除**（原 DELETE 吊销行为废弃）

## Schema

`api_keys` 增加可空列 `disabled_at TEXT`。  
既有库通过启动时 `PRAGMA table_info` + `ALTER TABLE` 迁移；新库 SCHEMA 直接含该列。

## Auth

`resolveApiKeyIdentity`：查询条件增加 `disabled_at IS NULL`（保留 `revoked_at IS NULL`）。

## Out of scope

- 批量操作、审计日志扩展、非管理员自助管理 Key
