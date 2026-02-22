---
'@opensaas/stack-cli': patch
---

Fix updatedAt field to include @default(now()) in generated Prisma schema to prevent migration failures on databases with existing data
