# Dispatch Failure Detail Implementation Plan

> **For agentic workers:** `docs/superpowers/specs/2026-11-16-dispatch-failure-detail-design.md`

**Goal:** Wake errors include project code; UI shows human how-to plus raw detail.

**Files:**
- `scripts/wake-agent.mjs` — workdir errors with optional project code
- `tests/wake-agent.test.ts` — cover new messages
- `src/lib/dispatch-detail.ts` — `explainDispatchDetail` (new, testable)
- `tests/dispatch-detail.test.ts` — mapping cases
- `src/components/AgentDispatch.tsx` — use helper for failure/skip display

## Task 1: Wake workdir messages
## Task 2: UI explain helper + wire-up
## Task 3: Verify tests; restart wake; rebuild Docker if needed
