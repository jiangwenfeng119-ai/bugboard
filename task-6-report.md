# Task 6 review fixes

## What changed

- `planGitSync` aborts whenever `ahead > 0 && behind > 0`. Auto-rebase of a diverge is out. `remoteContainsLocalHead` / `merge-base --is-ancestor` is no longer used.
- Deploy commands must be one absolute executable under `/Users`, `/opt`, `/usr`, `/homebrew`, or the workspace. `bash -c` and pipelines are rejected in the dispatch API and the runner. The runner uses `spawnSync(cmd, [], { shell: false })`.
- Sync and deploy run only when `HEAD` is the project default branch.
- A `running` release claim older than 45 minutes is marked failed so the next nightly enqueue is not blocked.

## Tests

```
npx vitest run tests/workspace-git.test.ts tests/release-runner.test.ts tests/release-config.test.ts tests/release-api.test.ts

 Test Files  4 passed (4)
      Tests  30 passed (30)
   Duration  4.18s
```

Also `tests/dispatch.test.ts`: 13 passed.
