---
'@opensaas/stack-core': patch
---

Fix a flaky substring-over-serialised-JSON leak assertion in `select.test.ts` (same shape as the `include.test.ts` flake fixed in #1479), using a structural exact-value check instead.
