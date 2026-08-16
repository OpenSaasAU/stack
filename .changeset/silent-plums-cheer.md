---
'@opensaas/stack-cli': patch
---

Fix migration introspector mapping Prisma/Keystone `Decimal` columns to `text()` instead of `decimal()`. Declared `@db.Decimal(precision, scale)` attributes now carry through to the generated field.
