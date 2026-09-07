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

`CLAUDE.md`'s package-structure tree still described `src/mcp/` as "MCP tool
generators", contradicting the export list 35 lines below it, and pointed its
test example at a `packages/rag/__tests__/` directory that does not exist.

Every `config()` sample in the package's `README.md` and `CLAUDE.md` carried
`db: { url: process.env.DATABASE_URL! }`, which has not been a member of
`DatabaseConfig` since the Prisma 8 rework — the samples failed to compile with
`TS2353`. The runtime resolves the URL itself, or takes a pool through
`db.client`:

```typescript
db: {
  provider: 'postgresql'
}
```

Documentation across the RAG surface claimed that `createdAt`/`updatedAt` are
added to every list automatically. Auto-timestamps have been **off by default**
since ADR-0004 (`resolveListTimestamps`): `id` is the only column added for you,
and a list opts in by declaring the two fields itself or by setting
`db: { timestamps: true }`, per list or globally. Neither RAG example opts in, so
neither carries them.

The docs prescribed `opensaas db migrate` for deployment. No such subcommand
exists — `opensaas db` registers only `update` — and the sentence sat beside this
PR's own text saying `db:update` needs a running dev loop, so the two read as a
contradiction. Deployment is `prisma migration plan` then `prisma db migrate`.
