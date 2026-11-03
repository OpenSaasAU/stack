---
'@opensaas/stack-cli': minor
---

Add `opensaas migrate junction-ids` to add and backfill the surrogate `id` on existing tables a list is mapped onto that have none, such as Prisma's implicit `_X_y(A, B)` many-to-many tables (ADR-0048).
It prints the SQL, writes it with `--out <file>`, or runs it in one transaction with `--apply`; it backfills `uuid7`, `cuid2`/`cuid` and `int autoincrement` ids, then sets the column `NOT NULL` and primary key, and is idempotent.
