# Hooks System

The hooks system provides data transformation and side effects during database operations.

## Overview

Hooks allow you to:

- Transform data before it's saved to the database
- Transform data before it's returned to the user
- Perform validation beyond basic field rules
- Trigger side effects (logging, notifications, etc.)

## Hook Types

### List-Level Hooks

Defined at the list level, these hooks run for all operations on the list:

```typescript
Post: list({
  fields: {/* ... */},
  hooks: {
    resolveInput: async ({ resolvedData, operation, context }) => {
      // Transform input data before database operation
      if (operation === 'create' && resolvedData.status === 'published') {
        resolvedData.publishedAt = new Date()
      }
      return resolvedData
    },
    validateInput: async ({ operation, resolvedData, addValidationError }) => {
      if (operation === 'delete') return
      // Custom validation logic
      if (resolvedData.title?.includes('spam')) {
        addValidationError('Title cannot contain spam')
      }
    },
    beforeOperation: async ({ operation, resolvedData, context }) => {
      // Side effects before database operation
      console.log(`About to ${operation} a post`)
    },
    afterOperation: async ({ operation, item, originalItem, context }) => {
      // Side effects after database operation
      if (operation === 'create') {
        // Send notification, invalidate cache, etc.
      }
      if (operation === 'update' && originalItem) {
        // Compare previous and new values
        console.log('Changed from:', originalItem, 'to:', item)
      }
    },
    beforeTransaction: async ({ operation, inputData }) => {
      // OUTSIDE the transaction — non-transactional side effects only.
    },
    afterTransaction: async (args) => {
      // OUTSIDE the transaction — always runs; compensate on rollback.
      if (args.status === 'rolled-back') {
        // undo whatever beforeTransaction did externally (args.error explains why)
      }
    },
  },
})
```

### Field-Level Hooks

Defined on individual fields:

```typescript
fields: {
  password: password({
    hooks: {
      resolveInput: async ({ resolvedData, fieldKey }) => {
        // Hash password before saving
        const plaintext = resolvedData[fieldKey]
        if (plaintext) {
          return await bcrypt.hash(plaintext, 10)
        }
      },
      resolveOutput: async ({ item, fieldKey }) => {
        // Wrap with HashedPassword class
        return new HashedPassword(item[fieldKey])
      },
    },
  }),
}
```

## Hook Execution Order

### Write Operations (create/update)

1. **List-level `resolveInput`** - Transform input data at list level
2. **Field-level `resolveInput`** - Transform individual field values
3. **List-level `validateInput`** - Custom validation logic
4. **Field validation** - Built-in rules (isRequired, length, min/max)
5. **Field-level access control** - Filter writable fields
6. **Field-level `beforeOperation`** - Side effects for individual fields
7. **List-level `beforeOperation`** - Side effects at list level
8. **Database operation**
9. **List-level `afterOperation`** - Side effects at list level
10. **Field-level `afterOperation`** - Side effects for individual fields

### Read Operations (query)

1. **Database operation**
2. **Field-level access control** - Filter readable fields
3. **Field-level `resolveOutput`** - Transform individual field values
4. **Field-level `afterOperation`** - Side effects for individual fields

## In-transaction vs transaction-boundary hooks

Every write runs inside one database transaction (see ADR-0010). The side-effect
hooks split into two families by where they run relative to that transaction:

- **In-transaction hooks — `resolveInput` / `validate` / `beforeOperation` /
  `afterOperation`.** They run _inside_ the transaction and roll back with it.
  Use them for work that must be atomic with the write — typically further
  database work through `context.db`/`context.prisma` (which the pipeline binds
  to the transaction for the duration of the write). A throwing `afterOperation`
  rolls the write back. **Do not** make non-transactional external calls (HTTP,
  email, billing) here: holding a transaction open across a network call is bad,
  and such calls can't be rolled back.

  Their `context` (list AND field level) is the **same full secured context**
  `context.transaction()`'s own callback receives (ADR-0012's amendment,
  issue #1176) — `context.sudo()`, `context.withSession()` and
  `context.transaction()` are all available, and every one of them stays bound
  to the write's OWN transaction client. A `context.sudo().db.x.create()` (or
  `.delete()`, `.update()`) issued from one of these hooks is therefore atomic
  with the write: it rolls back together if the write later throws, and its
  `afterTransaction` (if it has one) defers to the write's own transaction
  owner exactly like a plain `context.db` write does. `context.transaction()`
  called from inside one of these hooks **joins** the write's transaction —
  it never opens a nested one.

- **Transaction-boundary hooks — `beforeTransaction` / `afterTransaction`.** They
  run _outside_ the transaction and form a compensation bracket around it:
  - `beforeTransaction` runs **before** the transaction opens.
  - `afterTransaction` runs **after** it settles and **always runs** (when its
    paired `beforeTransaction` ran), receiving the outcome:
    `status: 'committed' | 'rolled-back'`. On `committed` it gets the persisted
    `item`; on `rolled-back` it gets the `error` that caused the rollback and **no
    `item`** — so it can undo whatever `beforeTransaction` did externally.

  Both fire **per list involved** in the write (the top-level list plus each
  nested create/update/delete list). The bracket is **symmetric**: a list's
  `afterTransaction` runs if and only if its `beforeTransaction` ran, so every
  external action taken has its paired compensator. A throwing
  `beforeTransaction` aborts the write (the transaction never opens) and triggers
  `afterTransaction` (`rolled-back`) only for the lists whose `beforeTransaction`
  already ran. If an `afterTransaction` itself throws, the remaining
  compensators still run and the error(s) are surfaced afterward — the database
  state is already final. Sudo does not affect these hooks; they always run.

  Important caveats for these hooks:
  - **`item`/`originalItem` are populated only for the TOP-LEVEL record.** On
    `committed`, the persisted `item` (and `originalItem` for update/delete) is
    surfaced only for the top-level list; for **nested** lists they are
    `undefined`. The per-record persisted row is not reliably recoverable outside
    the transaction, and these hooks fire at list (not record) granularity. For
    per-record nested compensation use the in-transaction `afterOperation`, which
    receives the correct nested `item`. Transaction-boundary hooks on nested lists
    are for external-call compensation keyed off `status`/`inputData`.
  - **Granularity is per-`(list, operation)`, not strictly per-list.** A list
    reached under two operations (e.g. a nested `create` _and_ a nested `update`
    of the same list) fires its boundary hooks **twice** — once per operation —
    and only the **first** nested record's `inputData` for that operation is
    surfaced. Many nested records of the same `(list, operation)` fire the bracket
    once.
  - **`connectOrCreate` is enumerated as create-involvement best-effort.** A
    `connectOrCreate` that resolves to **connect** (the row already exists) still
    fires the bracket as a `create` involvement even though no row is written.
    Write your compensators to be **idempotent** so a no-op write is safe to
    compensate.
  - **`afterTransaction` reports the OUTERMOST transaction, not the write's own
    return (ADR-0028).** A write that joins a transaction it did not open — one
    made inside `context.transaction()`, or a hook's own `context.db` write —
    cannot itself observe when that enclosing transaction settles. Its
    `afterTransaction` is deferred until the transaction owner
    (`context.transaction()`, or the Write Pipeline when it opened the
    transaction) observes the real settle, then fires with that outcome.
    `beforeTransaction` stays eager in every case — only the paired
    `afterTransaction` is deferred.
    - **Status is a conjunction:** `committed` if and only if the write itself
      succeeded **and** the enclosing transaction committed; otherwise
      `rolled-back`. A write's own error always wins over the transaction's
      outcome — a write that failed on its own reports `rolled-back` even if
      everything else in the transaction went on to commit.
    - **The deferred `item` is stale-safe, not stale-free.** It is the row as
      that write persisted it, captured at write time — not re-read at flush —
      so a later write to the same record in the same transaction leaves it
      stale in what the compensator sees.
    - **A rejected `context.transaction()` no longer implies rollback.** If the
      transaction commits and a deferred `afterTransaction` then throws,
      `context.transaction()` rejects with `AfterTransactionError` over data
      that is already final. A transaction/serialization error (e.g. `P2034`)
      still takes precedence and propagates unwrapped — a retry loop that
      catches broadly should not treat every rejection as "not committed".
    - **`beforeTransaction` can now run with the transaction already open.**
      Under `context.transaction()` it runs on the write's way in, so it holds
      that transaction open for its duration. Keep it fast, or hoist slow
      external work above `context.transaction()` — a `context.db` write from
      inside it can otherwise block on rows the transaction itself is writing.
    - **A write with no transaction owner at all** (an application managing its
      own `prisma.$transaction`, or a client that cannot open one — e.g. a bare
      test mock, with no `context.transaction()` wrapping it) still fires
      `afterTransaction` optimistically at write time, exactly as before — there
      is no owner to defer to and no settle to wait for.

### Compensation pattern

Pair an external action in `beforeTransaction` with its undo in
`afterTransaction`'s `rolled-back` branch:

```typescript
hooks: {
  beforeTransaction: async ({ operation, inputData }) => {
    // Non-transactional side effect — reserve an external resource.
    await billing.reserveSeat(inputData.seatId)
  },
  afterTransaction: async (args) => {
    if (args.status === 'rolled-back') {
      // The DB write did not persist — release what beforeTransaction reserved.
      await billing.releaseSeat(args.inputData.seatId)
    } else {
      // Committed — finalize the external action.
      await billing.confirmSeat(args.item.seatId)
    }
  },
}
```

## Hook Context

All hooks receive a context object with relevant information:

```typescript
interface HookContext {
  operation: 'create' | 'update' | 'delete' | 'query'
  session: Session | null
  context: Context
  listKey: string
  resolvedData?: any // For input hooks
  item?: any // Current item (after operation)
  originalItem?: any // Original item before operation (for update/delete)
  originalInput?: any // Original input before transformations
}
```

**`context` on `resolveInput` / `validate` / `beforeOperation` / `afterOperation`
(list and field level) is a full `StackContext` — the same shape
`context.transaction()`'s own callback receives (issue #1176), bound to the
write's transaction client:**

```typescript
hooks: {
  beforeOperation: async ({ context }) => {
    // Elevated, bound to THIS write's own transaction — rolls back with it.
    await context.sudo().db.auditLog.create({ data: { action: 'write' } })
  },
}
```

`context` on `beforeTransaction` / `afterTransaction` is unaffected — it stays
the plain access-checked context bound to the base (non-transaction) client,
per their existing contract.

A field's `resolveOutput` hook's `context` type is likewise unchanged (still
the plain access-checked context, no `sudo`/`withSession`/`transaction`), but
which client it's bound to already depended — before this change and after it
alike — on how the read that triggered it arose: a plain top-level read
(`findMany`/`findUnique`/`get`) resolves its fields against the base client; a
`resolveOutput` that runs as part of a create/update's OWN result (the write's
Field Visibility pass) resolves against THAT write's transaction client (ADR-0010),
so a `context.db` read/write issued from inside such a hook is atomic with the
write, same as `beforeOperation`/`afterOperation`.

## Common Use Cases

### Auto-Set Timestamps

```typescript
resolveInput: async ({ resolvedData, operation }) => {
  if (operation === 'create') {
    resolvedData.createdAt = new Date()
  }
  if (operation === 'update') {
    resolvedData.updatedAt = new Date()
  }
  return resolvedData
}
```

### Slug Generation

```typescript
fields: {
  slug: text({
    hooks: {
      resolveInput: async ({ resolvedData, item, operation }) => {
        // Generate slug from title if not provided
        if (!resolvedData.slug && resolvedData.title) {
          return resolvedData.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
        }
      },
    },
  }),
}
```

### Password Hashing

```typescript
password: password({
  hooks: {
    resolveInput: async ({ resolvedData, fieldKey }) => {
      const plaintext = resolvedData[fieldKey]
      if (plaintext) {
        return await bcrypt.hash(plaintext, 10)
      }
    },
  },
})
```

### Cache Invalidation

```typescript
afterOperation: async ({ operation, item, originalItem, context }) => {
  if (['create', 'update', 'delete'].includes(operation)) {
    // Invalidate cache
    await redis.del(`post:${item.id}`)

    // For updates, you can compare previous and new values
    if (operation === 'update' && originalItem) {
      if (originalItem.status !== item.status) {
        console.log(`Status changed from ${originalItem.status} to ${item.status}`)
      }
    }
  }
}
```

### Audit Logging

```typescript
beforeOperation: async ({ operation, resolvedData, context }) => {
  await context.db.auditLog.create({
    data: {
      operation,
      userId: context.session?.userId,
      timestamp: new Date(),
      data: resolvedData,
    },
  })
}
```

## Best Practices

### 1. Keep Hooks Pure

Avoid side effects in `resolveInput` and `resolveOutput`. Use `beforeOperation` and `afterOperation` for side effects:

```typescript
// ✅ Good: Pure transformation
resolveInput: ({ resolvedData }) => {
  resolvedData.title = resolvedData.title.trim()
  return resolvedData
}

// ❌ Bad: Side effects in resolveInput
resolveInput: async ({ resolvedData, context }) => {
  await sendEmail() // Don't do this here!
  return resolvedData
}
```

### 2. Use Async When Needed

All hooks can be async:

```typescript
resolveInput: async ({ resolvedData }) => {
  const result = await someAsyncOperation()
  resolvedData.field = result
  return resolvedData
}
```

### 3. Return Modified Data

Always return the modified data from `resolveInput`:

```typescript
// ✅ Good: Returns modified data
resolveInput: ({ resolvedData }) => {
  resolvedData.slug = generateSlug(resolvedData.title)
  return resolvedData
}

// ❌ Bad: Doesn't return
resolveInput: ({ resolvedData }) => {
  resolvedData.slug = generateSlug(resolvedData.title)
  // Missing return!
}
```

## Next Steps

- **[Access Control](/docs/concepts/access-control)** - Secure your data
- **[Field Types](/docs/concepts/field-types)** - Available field types
- **[Custom Fields](/docs/how-to/custom-fields)** - Create custom field types
