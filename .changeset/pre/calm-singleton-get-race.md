---
'@opensaas/stack-core': patch
---

Fix concurrent first `get()` on an empty singleton throwing `UniqueConstraintViolation`; the losing caller now reads the winner's row.
