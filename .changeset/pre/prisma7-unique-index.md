---
'@opensaas/stack-core': patch
'@opensaas/stack-cli': patch
---

Under `db.indexNaming: 'prisma7'`, emit plain uniques as unique indexes so adopting a Prisma 7 database plans no unique drop-and-re-add and composite foreign keys apply.
