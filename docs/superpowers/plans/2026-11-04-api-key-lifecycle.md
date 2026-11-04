# API Key Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show bound projects on API Key list; support edit, disable/enable, revoke, regenerate, and hard delete.

**Architecture:** Add `disabled_at` with SQLite ALTER migration; extend services + PATCH route; change DELETE to hard delete; update auth gate; expand `ApiKeysAdmin` UI.

**Tech Stack:** Next.js App Router, better-sqlite3, Vitest, React client components.

## Global Constraints

- Admin-only mutations (existing `requireAdmin`)
- User-level keys require ≥1 project; admin-level clears bindings
- Plaintext key only on create/regenerate, once
- Chinese UI copy consistent with admin page

---

### Task 1: Schema + types + auth gate

**Files:**
- Modify: `src/lib/db.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/auth.ts`

- [ ] Add `disabled_at TEXT` to `api_keys` in SCHEMA
- [ ] After `exec(SCHEMA)`, migrate existing DBs if column missing via `PRAGMA table_info`
- [ ] Add `disabled_at: string | null` to `ApiKeyRow`
- [ ] Auth query: `revoked_at IS NULL AND disabled_at IS NULL`
- [ ] Commit N/A if no git

### Task 2: Service layer + tests

**Files:**
- Modify: `src/lib/services.ts`
- Modify: `tests/services.test.ts`

**Produces:**
- `updateApiKey(identity, keyId, patch)`
- `deleteApiKey(identity, keyId)` (hard delete)
- Keep `revokeApiKey` or fold into update via `revoke: true`

- [ ] Write failing tests for disable, regenerate, revoke, delete, edit projects
- [ ] Implement `updateApiKey` / `deleteApiKey`
- [ ] Update `listApiKeys` SELECT to include `disabled_at`
- [ ] Run `npm test` — pass

### Task 3: API routes

**Files:**
- Modify: `src/app/api/api-keys/[id]/route.ts`
- Modify: `src/app/api/api-keys/route.ts` (list includes disabled_at if needed)

- [ ] `PATCH`: map body → `updateApiKey`; return `rawKey` when regenerate
- [ ] `DELETE`: call `deleteApiKey` (physical)
- [ ] Errors → JSON with status

### Task 4: Admin UI

**Files:**
- Modify: `src/app/admin/ApiKeysAdmin.tsx`

- [ ] Column 绑定项目 between 角色 and 最近使用
- [ ] Status: 有效 / 已禁用 / 已吊销
- [ ] Actions: 编辑 / 禁用|启用 / 吊销 / 删除 per status matrix
- [ ] Inline edit form + regenerate reuses plaintext banner
- [ ] Confirm on revoke and delete

### Task 5: Verify

- [ ] `npm test`
- [ ] Lint touched files if available
