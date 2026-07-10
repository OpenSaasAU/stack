---
'@opensaas/stack-core': patch
---

Fix `calendarDay` writes 500ing on Prisma 7 `@db.Date` columns — a `resolveInput` hook now coerces a `YYYY-MM-DD` string to a UTC-midnight `Date` before validation, and the field's zod schema accepts either shape.
