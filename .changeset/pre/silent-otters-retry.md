---
'@opensaas/stack-core': patch
---

Fix a flaky test: `lower.test.ts`'s vector-lowering retry case no longer cold-imports the real ORM module inside the timed test body.
