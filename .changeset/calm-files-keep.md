---
'@opensaas/stack-storage': patch
---

Fix `cleanupOnDelete` on `file()` and `image()` removing the stored asset when the delete's transaction rolls back; cleanup now runs after commit.
