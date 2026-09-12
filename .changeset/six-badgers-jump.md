---
'@opensaas/stack-auth': patch
---

Fix `betterAuthOptions.advanced.database.generateId` being refused for `false`, `'uuid'`, and `undefined` — the check now only refuses a custom function or `'serial'`, the values genuinely incompatible with the adapter's id strategy.
