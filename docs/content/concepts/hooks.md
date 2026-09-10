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
  fields: { title: text(), status: text(), publishedAt: timestamp() },
  hooks: {
    resolveInput: async ({ resolvedData, operation }) => {
      if (operation === 'create' && resolvedData.status === 'published') {
        resolvedData.publishedAt = new Date()
      }
      return resolvedData
    },
    validate: async (args) => {
      if (args.operation === 'delete') return
      const title = args.resolvedData.title
      if (typeof title === 'string' && title.includes('spam')) {
        args.addValidationError('Title cannot contain spam')
      }
    },
    beforeOperation: async ({ operation }) => {
      console.log(`About to ${operation} a post`)
    },
    afterOperation: async (args) => {
      if (args.operation === 'update') {
        console.log('Changed from:', args.originalItem, 'to:', args.item)
      }
    },
    beforeTransaction: async ({ listKey, operation }) => {
      await audit.recordIntent(listKey, operation)
    },
    afterTransaction: async ({ listKey, operation, status }) => {
      if (status === 'rolled-back') await audit.withdrawIntent(listKey, operation)
    },
  },
})
```

`validate` is the current name; `validateInput` is kept as a deprecated alias
for Keystone compatibility and behaves identically. `beforeTransaction` and
`afterTransaction` run **outside** the write's transaction and are for
non-transactional side effects only — the section below explains the split.

### Field-Level Hooks

Defined on individual fields. A field hook is handed `fieldKey`, and reads its own value out of
`resolvedData[fieldKey]`. `resolveOutput` is handed the value directly, as
`value`:

```typescript
fields: {
  password: password({
    hooks: {
      resolveInput: async ({ resolvedData, fieldKey }) => {
        const plaintext = resolvedData[fieldKey]
        if (typeof plaintext !== 'string') return undefined
        return await bcrypt.hash(plaintext, 10)
      },
      resolveOutput: ({ value }) => (typeof value === 'string' ? mask(value) : value),
    },
  }),
}
```

## Hook Execution Order

### Write Operations (create/update)

Everything below sits **inside** the write's transaction except step 0 and the
`beforeTransaction`/`afterTransaction` bracket around the whole thing.

0. **Operation-level access check** — a denial short-circuits to `null` here,
   before any hook runs. A denied write fires no hooks at all, boundary hooks
   included.
1. **List-level `resolveInput`** — transform input data at list level
2. **Field-level `resolveInput`** — transform individual field values
3. **List-level `validate`** — custom validation logic
4. **Field-level `validate`** — custom validation for individual fields
5. **Field validation** — built-in rules (`isRequired`, length, min/max)
6. **Field-level access control** — filter writable fields
7. **Relation resolution** — a `connect` becomes a foreign key, or `null` clears
   one. An unreachable target ends the write as `null`, before step 8.
8. **Field-level `beforeOperation`** — side effects for individual fields
9. **List-level `beforeOperation`** — side effects at list level
10. **Database operation**
11. **List-level `afterOperation`** — side effects at list level
12. **Field-level `afterOperation`** — side effects for individual fields

A `delete` skips steps 1–2 and 5–7: there is no input to shape, so it runs
`validate` (list, then field), then the `beforeOperation`/`afterOperation`
brackets around the database call.

Validation is the one failure that is **not** silent: steps 3–5 throw a
`ValidationError`. Every other refusal on this list answers `null`.

### Read Operations (query)

1. **Database operation**
2. **Field-level access control** — filter readable fields
3. **Field-level `resolveOutput`** — transform individual field values, and
   compute virtual fields

There is no `beforeOperation`/`afterOperation` on a read. `resolveOutput` is the
only hook a query runs.

## In-transaction vs transaction-boundary hooks

Every write runs inside one database transaction (see ADR-0010). The side-effect
hooks split into two families by where they run relative to that transaction:

- **In-transaction hooks — `beforeOperation` / `afterOperation`.** They run
  _inside_ the transaction and roll back with it. Use them for work that must be
  atomic with the write — typically further database work through
  `context.db` (which the pipeline binds to the transaction for the duration of
  the write; so is `context.ormHandle`, the engine's own ORM handle, if you have
  a reason to skip the secured surface). A throwing `afterOperation` rolls the
  write back.
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
  - **Write your compensators to be idempotent.** A bracket can fire for an
    involvement that turns out to write no row, so a no-op compensation must be
    safe to run.
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
      `context.transaction()` rejects with an `AfterTransactionError` over data
      that is already final. That class is not exported, so match on
      `error.name`. A transaction error — `SerializationFailure` among
      them — still takes precedence, so a retry loop keyed on it is unaffected;
      one that catches broadly should not treat every rejection as "not
      committed".
    - **`beforeTransaction` can now run with the transaction already open.**
      Under `context.transaction()` it runs on the write's way in, so it holds
      that transaction open for its duration. Keep it fast, or hoist slow
      external work above `context.transaction()` — a `context.db` write from
      inside it can otherwise block on rows the transaction itself is writing.
    - **A write with no transaction owner at all** — a client that cannot open
      one, such as a bare test double, with no `context.transaction()` wrapping
      it — still fires `afterTransaction` optimistically at write time: there is
      no owner to defer to and no settle to wait for.

### Compensation pattern

Pair an external action in `beforeTransaction` with its undo in
`afterTransaction`'s `rolled-back` branch. Both hooks are discriminated unions
over `operation` and (for `afterTransaction`) `status`, so narrow before
reaching for a field — a `delete` rollback carries no `inputData` at all:

```typescript
hooks: {
  beforeTransaction: async (args) => {
    if (args.operation !== 'create') return
    await billing.reserveSeat(args.inputData.seatId)
  },
  afterTransaction: async (args) => {
    if (args.operation !== 'create') return
    if (args.status === 'rolled-back') {
      await billing.releaseSeat(args.inputData.seatId)
      return
    }
    if (args.item !== undefined) await billing.confirmSeat(args.item.seatId)
  },
}
```

## Hook Arguments

Every hook receives an object, and every one of those objects carries `listKey`,
`operation` and `context` — the `AccessContext`, whose members are `session`,
`db`, `storage`, `plugins` and `ormHandle`. The rest differs per hook and per
operation, because the shapes are **discriminated unions on `operation`** rather
than one wide type with everything optional: a `create`'s `resolveInput` has no
`item`, and TypeScript will not let you read one.

The names that recur:

- `inputData` — the data as the caller passed it, before any transformation.
- `resolvedData` — the data as the `resolveInput` chain has left it so far.
- `item` — the existing row. Absent on `create`; present on `update`/`delete`.
- `originalItem` — the pre-write row, on `afterOperation` for update and delete.
- `fieldKey` — on field hooks only, the field this hook belongs to. The one
  exception is field `resolveOutput`, which names it `fieldName`.
- `addValidationError(msg)` — on `validate` hooks only.

The [Config API reference](/docs/reference/config-api) gives each hook's exact
argument shape per operation.

## Common Use Cases

### Timestamps

`createdAt` and `updatedAt` are not something to write a hook for. Set
`db: { timestamps: true }` — on one list, or on `db` for every list at once —
and the generator adds both. `createdAt` takes a database default; `updatedAt`
is maintained by the write pipeline.

Reach for `resolveInput` for a _domain_ timestamp instead — one whose value is a
decision rather than a clock reading:

```typescript
resolveInput: async ({ resolvedData, operation }) => {
  if (operation === 'update' && resolvedData.status === 'published') {
    resolvedData.publishedAt = new Date()
  }
  return resolvedData
}
```

### Slug Generation

A field-level `resolveInput` returns the field's own new value, not the whole
payload. Two rules decide whether it can do this job at all, and both point the
same way:

{% callout type="warning" %}
**A field `resolveInput` only runs when its own key is already in the payload**
— `if (!(fieldKey in result)) continue`
(`packages/core/src/hooks/index.ts:468`). On the create this recipe is written
for, where the caller supplies `title` and omits `slug`, a field hook on `slug`
never fires. And its return value is assigned **unconditionally**
(`hooks/index.ts:484`), so returning `undefined` does not leave the existing
value alone — it writes `undefined`.
{% /callout %}

Deriving a field the caller did not send is therefore list-level work. A
list-level `resolveInput` always runs and returns the whole payload, so it can
add a key that was not there:

```typescript
Post: list({
  fields: {
    title: text({ validation: { isRequired: true } }),
    slug: text({ isIndexed: 'unique' }),
  },
  hooks: {
    resolveInput: async ({ resolvedData }) => {
      const { slug, title } = resolvedData
      if (typeof slug === 'string' && slug.length > 0) return resolvedData
      if (typeof title !== 'string') return resolvedData
      return {
        ...resolvedData,
        slug: title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, ''),
      }
    },
  },
})
```

Use a field `resolveInput` for the job it is shaped for: transforming a value
the caller **did** send — hashing a password, normalising a phone number,
trimming whitespace.

### Cache Invalidation

`afterOperation` narrows on `operation`: only `update` carries both `item` and
`originalItem`, and `delete` carries `originalItem` alone.

```typescript
afterOperation: async (args) => {
  if (args.operation === 'delete') {
    await redis.del(`post:${args.originalItem.id}`)
    return
  }

  await redis.del(`post:${args.item.id}`)

  if (args.operation === 'update' && args.originalItem.status !== args.item.status) {
    console.log(`Status changed from ${args.originalItem.status} to ${args.item.status}`)
  }
}
```

### Audit Logging

A hook's `context.db` is bound to the write's own transaction, so the audit row
rolls back with the write it describes. It is also still access controlled — a
`create` the session may not perform answers `null` rather than throwing, so
check it if the audit row is load-bearing:

```typescript
beforeOperation: async ({ listKey, operation, context }) => {
  const entry = await context.db.AuditLog.create({
    data: {
      listName: listKey,
      operation,
      userId: context.session?.userId ?? 'anonymous',
    },
  })

  if (entry === null) throw new Error(`Could not record an audit entry for ${listKey}.${operation}`)
}
```

## What a `resolveOutput` hook may read

A `resolveOutput` hook is handed **exactly its field's declared `needs` plus the
list's system fields** — never what the caller selected. That is what keeps a
computed field's value the same from every call site, and
[Queries & projections](/docs/concepts/queries) explains the mechanism.

### The cost: undeclared reads, dead branches, and the second hop

Three prices come with that guarantee, and they are worth naming outright.

**An undeclared read breaks silently — unless you are typed.** A hook that reads
a column its field did not declare in `needs` finds `undefined` there at
runtime, and nothing tells you: the field just computes the wrong value. Typed
through the generated `Lists.<List>.TypeInfo` — the documented pattern,
`list<Lists.Post.TypeInfo>({ … })` — it is a **compile error** instead, because
`item` is narrowed to precisely the declared set. Annotate your lists; the
declaration is only enforced where you asked for it to be.

**A declared-only branch computes nothing.** When `needs` names a relation, the
engine fetches that relation's **stored columns** for your hook and stops. It
does not run the related list's own computed fields over it, because those
fields' dependency sets were never fetched — a hook reading one there would
dereference `undefined` and fail the whole read. So a declared relation gives
you data, not a fully resolved row.

**Two hops cost a privileged read.** `needs` is one hop and non-transitive: it
names stored columns and immediate relations on the same list, nothing further.
A value two relations away is not something you can declare — the hook has to go
and read it, through a context that can see it, and pay for that read on every
row it runs on.

See [ADR-0051](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0051-declared-dependencies-are-an-emitted-one-hop-set.md)
and [ADR-0052](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0052-the-generated-types-declare-the-contract-remainder-and-instantiate-core-generics.md).

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
- **[Queries & projections](/docs/concepts/queries)** - What a read returns, and what a hook is handed
- **[Context API](/docs/reference/context-api)** - `context.transaction()`, row locks and the unsafe surface
- **[Field Types](/docs/concepts/field-types)** - Available field types
- **[Custom Fields](/docs/how-to/custom-fields)** - Create custom field types
