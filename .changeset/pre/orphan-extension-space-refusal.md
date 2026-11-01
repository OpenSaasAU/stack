---
'@opensaas/stack-cli': patch
---

`opensaas generate` now refuses when `migrations/` carries a contract-space directory for a pack no longer in `db.extensions`, naming the directory instead of exiting 0 and leaving `db init`/`db update` to fail later.
