---
'@opensaas/stack-core': patch
---

`pnpm generate` now refuses configs that fail at apply: a `db.foreignKeys` entry referencing a partial unique, repeating another entry's columns, or pairing mismatched column types; constraint names over 63 bytes; and an index name shared across lists or equal to a table name.
