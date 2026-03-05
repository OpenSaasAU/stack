---
'@opensaas/stack-cli': patch
---

Fix regression where list-only many-to-many relationships no longer generated synthetic back-reference fields on the target model, causing Prisma schema validation errors
