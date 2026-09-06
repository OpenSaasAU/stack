---
'@opensaas/stack-core': minor
'@opensaas/stack-auth': minor
'@opensaas/stack-rag': minor
---

`AccessContext.prisma` becomes `AccessContext.ormHandle`

The engine's internal ORM handle now carries a name that says what it is. The public bypass was renamed to `context.unsafe` first; until now the handle underneath it was still called `prisma`, so a reader could not tell which of the two a `prisma` in the source meant.

`ormHandle` is the client the secured surface's terminals, the Write Pipeline and the access filter actually issue their queries through. The engine applies the Access Filter, Field Visibility and hooks _around_ it, so the handle itself enforces none of them — the same absence of protection as `context.unsafe`, on a different object. `AccessContext` has no `unsafe` member, so `ormHandle` is what a hook or a plugin `runtime()` factory is handed.

```typescript
// Before
const plugin = {
  runtime: (context) => ({
    getAuditTrail: (listName: string) => context.prisma.auditLog.findMany({ where: { listName } }),
  }),
}

// After
const plugin = {
  runtime: (context) => ({
    getAuditTrail: (listName: string) =>
      context.ormHandle.auditLog.findMany({ where: { listName } }),
  }),
}
```

The Write Pipeline binds `ormHandle` to the write's transaction alongside `context.db`, as it did before, so database work a `beforeOperation`/`afterOperation` hook does through it still rolls back with the write.

`getContext()`'s second positional parameter is renamed to match; it is positional, so no call site changes. `@opensaas/stack-auth`'s better-auth wiring and `@opensaas/stack-rag`'s vector search now read `context.ormHandle`.
