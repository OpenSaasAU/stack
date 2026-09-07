---
'@opensaas/stack-core': minor
---

Drop transaction options and make database errors stack-owned

`context.transaction(fn)` takes no options and runs at the connection's default isolation level — Read Committed on PostgreSQL. `isolationLevel`, `maxWait`, `timeout`, the `TransactionIsolationLevel` union, `TransactionOptions` and `TransactionOptionsUnsupportedError` are deleted, so asking for an isolation level is a compile error at the call site rather than a value the client silently downgrades.

Every engine terminal now raises a stack-owned error in place of the driver's own, each with an `is*` predicate:

```typescript
import { isUniqueConstraintViolation, isSerializationFailure } from '@opensaas/stack-core'

try {
  await context.db.User.create({ data: { email } })
} catch (error) {
  if (isUniqueConstraintViolation(error)) {
    // { email: 'This email is already in use' }
    return { fieldErrors: error.fieldErrors }
  }
  if (isSerializationFailure(error)) return retry()
  throw error
}
```

A unique violation resolves through the constraint map the generator emits, so it names the OpenSaas **fields** the violated constraint covers. A constraint managed by hand in the database is not in that map and falls through to the generic `'A record with this value already exists'` with no fields — the map's limit, stated rather than hidden.

Errors raised at `COMMIT` are normalised the same way, at the transaction owner's settle and before the deferred-hook flush, so a `DEFERRABLE INITIALLY DEFERRED` constraint never escapes as a raw driver error and ADR-0028's precedence rule (transaction errors ahead of hook errors) keeps operating on a normalised value.

A `DatabaseError`'s message is always stack-authored; the driver's own text — which names columns, tables and constraint names — is on `cause`, for a server-side log rather than a browser. A failure the classification does not recognise carries `'The database refused this operation'`.

`context.serverAction` — the surface the admin UI drives — logs that `cause` to the server console before returning the stack-authored message to the client, so a database failure stays diagnosable to the operator without the driver's text ever reaching the browser.

An application's own error wins over the stack's. Catching a stack error and rethrowing your own with `{ cause }` reaches the caller as your error, not as the `UniqueConstraintViolation` underneath it.

`context.unsafe` is deliberately excluded and still rejects with the driver's own error, consistent with its bypassing everything else.

`DatabaseError.code` is removed along with every `P####` discriminant, the English-prose regex and the identifier stripping in `prisma-errors.ts`; `uniqueConstraintOf` and `UniqueConstraintInfo` are gone with them. Prisma 8 raises no such codes, so each was a string compare that would have failed silently. See ADR-0042.
