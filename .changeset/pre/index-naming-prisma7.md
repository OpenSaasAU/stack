---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

Add `db.indexNaming: 'prisma7'`, which names every derived index, unique constraint and foreign key `<Table>_<cols>_idx` / `_key` / `_fkey` (63-byte truncated), so adopting a Prisma 7 database plans no index renames.
