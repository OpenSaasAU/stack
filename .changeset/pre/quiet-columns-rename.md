---
'@opensaas/stack-cli': minor
---

Add `opensaas migrate fk-renames` to emit the ADR-0069 `<field>` → `<field>Id` foreign-key column renames (plus default-named FK/unique/index constraints) against an existing database.
It prints the SQL, writes it with `--out <file>`, or runs it in one transaction with `--apply`; it never drops anything, is idempotent, and refuses when both `<field>` and `<field>Id` exist.
