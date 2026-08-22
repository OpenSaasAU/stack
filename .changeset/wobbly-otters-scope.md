---
'@opensaas/stack-core': patch
---

Fix `include` on a to-one relationship throwing `PrismaClientValidationError` when the related list's `query` access resolves to a filter (Prisma only accepts a nested `where` on a to-many include). The relation is now fetched and access-scoped via a batched existence check instead, returning `null` for an excluded related row rather than throwing — a caller relying on the previous exception, or whose types assumed a non-null relation, should re-check nullability.
