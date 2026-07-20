---
'@opensaas/stack-auth': patch
---

Add a regression test locking the generated Session/Account user FK shape (no `@@index([userId])`, `onDelete: Cascade`) so future drift from better-auth parity is caught.
