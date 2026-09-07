---
'@opensaas/stack-rag': minor
'@opensaas/stack-cli': minor
---

Correct the RAG agent guidance for the native vector column, and prove the declared-dependency read under exact selection

`packages/rag/CLAUDE.md` described the world before `embedding()` became a
pgvector column. Two sections were wrong in ways that produced code that throws:

- Automatic generation was documented as a field-level `afterOperation` hook
  writing the embedding through `context.db.Article.update(...)`. That write is
  exactly what the field's write denial now refuses. The section describes the
  real path instead — a list-level `afterTransaction` hook, running after the
  commit, writing through the plugin's own escalated path — and points at
  `embedding({ allowManualWrites: true })` for an app that maintains its own
  vectors.
- The migration guide claimed "Existing embeddings in JSON format are
  compatible" and prescribed `pnpm db:push`. There is no conversion: the vector
  is a `vector(n)` column with a `jsonb` metadata sibling, and an embedding is
  derived data that is regenerated from its source text. The workflow is
  `pnpm generate` + `pnpm db:update`.

The CLI's field-package contract test now reads a multi-column storage field
through a real table under `.select()`, with a computed field that declares it
and an identical one that declares nothing:

```typescript
badge: virtual({
  type: 'string',
  needs: ['hero'],
  hooks: { resolveOutput: ({ item }) => heroOf(item) },
})
```

The declaring hook receives the assembled value — the widening resolves the
logical key to its part columns — and the non-declaring one reads `undefined`
on the same row.
