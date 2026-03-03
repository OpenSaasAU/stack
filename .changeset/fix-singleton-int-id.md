---
'@opensaas/stack-core': patch
'@opensaas/stack-cli': patch
---

Fix singleton lists to use `Int @id @default(1)` matching Keystone 6 behaviour

Singleton lists now generate `Int @id @default(1)` in the Prisma schema instead of
`String @id @default(cuid())`. This matches Keystone 6's behaviour where singleton
records always use integer primary key `1`, making migration from Keystone 6 straightforward
without data loss.

**Migration guide for existing singleton lists:**

If you have an existing database with singleton models that use `String @id`, you will need
to run an SQL migration to convert the id column from text to integer:

```sql
-- Example for PostgreSQL (adjust table name as needed)
ALTER TABLE "EmailSettings" ALTER COLUMN id TYPE INTEGER USING id::integer;
UPDATE "EmailSettings" SET id = 1;
```

For SQLite (which does not support ALTER COLUMN):
```sql
-- Recreate the table with Int id
CREATE TABLE "EmailSettings_new" (id INTEGER PRIMARY KEY DEFAULT 1, ...);
INSERT INTO "EmailSettings_new" SELECT 1, ... FROM "EmailSettings";
DROP TABLE "EmailSettings";
ALTER TABLE "EmailSettings_new" RENAME TO "EmailSettings";
```

New projects and fresh databases will work automatically without any migration steps.
Fixes #350.
