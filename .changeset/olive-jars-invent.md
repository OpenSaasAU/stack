---
'@opensaas/stack-rag': minor
---

Document the manual-write opt-out where the guidance shows a manual write, and correct the export list

`packages/rag/CLAUDE.md`'s "Manual Embedding Storage" section showed an ordinary
`context.db.Article.create({ data: { contentEmbedding: { … } } })` with no
mention of `allowManualWrites`. `embedding()` defaults that to `false` and denies
the write, so an agent following the section got
`Cannot create "contentEmbedding": field-level access denied.` — the same defect
that was fixed in the automatic-generation section 130 lines below it. The
section now declares the field before it writes to it:

```typescript
fields: {
  title: text(),
  contentEmbedding: embedding({ dimensions: 1536, allowManualWrites: true }),
}
```

The export list carried two stale signatures: `generateEmbeddings(config, text, provider)`
is `generateEmbeddings({ provider, texts, … })`, and `chunkText(text, strategy)`
is `chunkText(text, options)` with `strategy` a member of `options`. It now also
names `generateEmbedding()` and `searchable()`, and says that
`@opensaas/stack-rag/mcp` carries types rather than the tools — `ragPlugin`
registers those itself.

`README.md` said `pnpm generate` writes "the extension's migration alongside the
app's". Generation seeds a contract space for each declared extension pack and
writes no app migration of its own; the app's schema history comes from
`prisma migration plan`. The README also prescribed a bare `pnpm db:update`,
which opens no connection of its own and exits non-zero unless an `opensaas dev`
loop is listening.
