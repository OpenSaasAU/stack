---
'@opensaas/stack-core': patch
---

Fix `P2002` unique-constraint errors losing per-field detail under Prisma 7 driver adapters (`@prisma/adapter-pg`, PGlite), where `meta.target` is left empty. The error handler now recovers the violated columns and constraint name from the adapter's error shape, and a new `uniqueConstraintOf(error)` helper exposes this to callers of `context.db.*` directly. Unique-violation messages under driver adapters change from the generic fallback back to field-specific text.
