---
'@opensaas/stack-core': patch
---

Fix a stale test expectation in `filter.test.ts` that still asserted the pre-#1504 `undefined` where for an undegradable filter token, causing the `test` job to fail on unrelated PRs.
