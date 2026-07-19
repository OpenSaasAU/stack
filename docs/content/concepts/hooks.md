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

- **In-transaction hooks — `beforeOperation` / `afterOperation`.** They run
  _inside_ the transaction and roll back with it. Use them for work that must be
  atomic with the write — typically further database work through
  `context.db`/`context.prisma` (which the pipeline binds to the transaction for
  the duration of the write). A throwing `afterOperation` rolls the write back.
  **Do not** make non-transactional external calls (HTTP, email, billing) here:
  holding a transaction open across a network call is bad, and such calls can't
  be rolled back.

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

- **[Access Control](/docs/core-concepts/access-control)** - Secure your data
- **[Field Types](/docs/core-concepts/field-types)** - Available field types
- **[Custom Fields](/docs/guides/custom-fields)** - Create custom field types
