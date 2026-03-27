---
'@opensaas/stack-cli': patch
---

Fix missing `query` parameter in generated `FindManyArgs` and `FindUniqueArgs` types

Passing a fragment to `context.db.post.findMany({ query: fragment })` or `context.db.post.findUnique({ where: { id }, query: fragment })` no longer produces a TypeScript error. The generator now emits `query?: Fragment<PostOutput, FieldSelection<PostOutput>>` in the relevant args types.
