---
'@opensaas/stack-auth': minor
'@opensaas/stack-core': minor
---

Drive better-auth through a stack-authored Auth adapter over the Unsafe surface

`@opensaas/stack-auth` no longer hands better-auth `prismaAdapter`. It builds its
own adapter with better-auth's `createAdapterFactory`, running on the Unsafe
surface a Prisma 8 context carries: eight methods on the ORM lane, and
`incrementOne` plus an unconditional `deleteMany` as single typed-SQL statements
through the surface's own executors. `consumeOne` is `where(…).delete()`, which
Prisma resolves to one identity and deletes with `RETURNING` — the at-most-one
guarantee better-auth asks for. See ADR-0060.

`createAuth(config, rawOpensaasContext)` keeps its signature; nothing in an
app's `lib/auth.ts` changes. Two new keys are refused at config time, alongside
the existing `betterAuthOptions.database`:

```typescript
authPlugin({
  betterAuthOptions: {
    // both throw: the database mints auth ids, and the adapter implements no joins
    advanced: { database: { generateId: () => id, joins: true } },
  },
})
```

`authPlugin` now pins `db.idField: 'uuid7'` on every list it injects, so auth
ids are minted by the database like every other list's.

`@opensaas/stack-core` gains the engine-owned LIKE-pattern escaping the adapter
lowers `contains` / `starts_with` / `ends_with` and insensitive `eq` through
(`escapeLikeLiteral` and the four pattern builders, on
`@opensaas/stack-core/internal`) — one escaper, shared with the secured
surface's Where vocabulary.

Known limits of the adapter, all stated: no joins, no `createSchema` (so
better-auth's CLI is unsupported against it), no transaction option yet, and
errors arrive as the driver's own rather than normalised.
