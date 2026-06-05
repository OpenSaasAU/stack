---
'@opensaas/stack-cli': patch
---

Fix migration introspectors mapping Prisma/Keystone Float columns to the non-existent `float()` builder; they now map to `decimal()` and warn about the Float→Decimal type change.
