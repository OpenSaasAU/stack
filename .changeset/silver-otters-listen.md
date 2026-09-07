---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

Every write through `context.db` opens a real Prisma 8 transaction again

The Write Pipeline decided whether to open a transaction by probing the client
for `$transaction` — the Prisma 7 name, which no Prisma 8 object carries. The
guard was constant-false, so every write ran with no transaction and no
rollback guarantee: a multi-statement write that failed partway, or a hook that
threw after the database call, left its rows committed.

The transaction capability is now an explicit signal rather than a probed
method name. `getContext` resolves a `TransactionOpener` from the Prisma 8
client it is handed, and puts it on the context; a context that is already
bound to an open transaction — `context.transaction()`'s callback, a hook's
rebound context — carries none, so a joined write still joins the enclosing
transaction rather than opening a second one (ADR-0028). `context.transaction()`
opens through the same opener, so both paths share one mechanism.

The generated context now hands `getContext` the ORM handle rather than the
client, which is what the engine reaches models through:

```typescript
// .opensaas/context.ts (generated)
getOpensaasContext(
  config,
  ormHandleFor(config, db),
  session,
  storage,
  false,
  undefined,
  undefined,
  db,
)
```

`requireOrmHandle(config, orm)` is exported from `@opensaas/stack-core` for a
caller that builds a context over a Prisma 8 client of its own, and throws
`OrmHandleUnresolvableError` naming the config's lists when the client exposes
no collection for one of them.
