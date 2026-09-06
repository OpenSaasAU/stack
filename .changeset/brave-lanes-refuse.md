---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

`context.prisma` becomes the Unsafe surface, `context.unsafe`

The deliberately unsecured handle now carries a name that states the bypass, and it is Prisma 8's own query lanes rather than a bare client. Everything the secured surface does, it skips — no access filter, no field visibility, no `resolveOutput`, no hooks, no error normalisation — and every execution enters the unsafe origin, so the tripwire lets it through and a query issued by neither surface is still refused.

```typescript
// Before
const posts = await context.prisma.post.findMany()

// After — the ORM lane, behind a transparent proxy that marks every call
const posts = await context.unsafe.orm.public.Post.all()

// Rows, streamed, from a typed SQL plan
const rows = context.unsafe.query(context.unsafe.sql.public.Post.select('id').build())
for await (const row of rows) {
  // consumed after the scope closed, still marked
}

// Statistics from a raw statement
const stats = await context.unsafe.execute(
  context.unsafe.raw.sql`UPDATE "public"."Post" SET "published" = true`.affectedCount().build(),
)
```

`sql` and `raw` are Prisma's builders untouched. The surface hands out neither the bare client nor `prepare()`/`runtime()` — they are not among its own members, in the type or in the runtime value — because either would execute a statement the tripwire never sees.

Inside `context.transaction(...)`, the transaction context's `unsafe` runs its plans through the transaction's own executor while keeping the client's contract-scoped raw lane, so a script no longer has to close over the outer client. The engine's own ORM handle is rebound to the transaction's collections at the same time: a Prisma 8 transaction holds one pooled connection for the whole callback, so a `db` left on the outer handle would commit outside the open transaction, or wait for a second connection the dev database's single-connection pool never frees. Transaction `options` a Prisma 8 client cannot honour — `isolationLevel` most of all — are refused with `TransactionOptionsUnsupportedError` rather than silently downgraded.

Core exports the surface and its builders from `@opensaas/stack-core` and `@opensaas/stack-core/unsafe`; the generated context hands the client to `getContext` so it can build one.
