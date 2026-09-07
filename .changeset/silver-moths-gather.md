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
  derived data that is regenerated from its source text.
- The guide now says how the schema change is actually applied, because
  `db:update` is not `db:push`'s drop-in replacement. `opensaas db update` opens
  no connection of its own — it hands the request to a running `opensaas dev`
  loop and exits non-zero when none is listening — so locally the loop applies
  the change (`pnpm dev`, against `DATABASE_URL` when set and the Dev database
  otherwise), a destructive plan such as a dimension change needs
  `pnpm db:update --confirm <database name>` from a second terminal, and a
  deployment has no loop at all and migrates with `prisma migration plan` then
  `prisma db migrate`.
- Automatic generation is gated on `autoGenerate` alone; a field carrying it
  with no `sourceField` is a config error that `pnpm generate` throws on, not a
  silent skip. And the dimension-change recipe no longer tells the reader to
  re-save rows to regenerate without noting that the plugin's write is inert on
  this branch (#1124, #1127), so nothing regenerates yet.

`examples/rag-ollama-demo`'s README described `pnpm generate` as writing "the
contract's own migrations". It writes the Contract module and `prisma.config.ts`,
emits `prisma/contract.json` and `prisma/contract.d.ts` — both of which have to
be committed — and seeds only declared extension packs' spaces under
`migrations/`. The app's own schema history comes from `prisma migration plan`.

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
