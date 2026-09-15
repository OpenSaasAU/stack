---
'@opensaas/stack-core': patch
'@opensaas/stack-cli': patch
---

Fix a computed field (`{ kind: 'computed' }` with no `virtual` flag) whose value was written on `create`/`update` instead of skipped — the same bug #1531 fixed on the read path, missed on the write path (`filterWritableFields`).
