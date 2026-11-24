---
'@opensaas/stack-cli': patch
---

Fix `migrate fk-renames` truncating long constraint names, give both migrate commands a clean error with no database, wrap `fk-renames --out` SQL in a transaction, and make `junction-ids` refuse composite-key tables.
