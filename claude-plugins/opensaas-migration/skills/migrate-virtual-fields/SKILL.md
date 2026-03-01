---
name: migrate-virtual-fields
description: Migrate Keystone virtual fields to OpenSaaS Stack format. Invoke as a forked subagent when virtual fields are detected, passing the config file path and field details as arguments.
context: fork
agent: general-purpose
---

Migrate the virtual fields described below to OpenSaaS Stack format. OpenSaaS Stack has no GraphQL — virtual fields use `hooks.resolveOutput` with a `type` declaration instead of `graphql.field()`.

$ARGUMENTS

## Migration Pattern

For every virtual field, apply this transformation:

**Before (Keystone):**

```typescript
import { graphql } from '@keystone-6/core'

fieldName: virtual({
  field: graphql.field({
    type: graphql.String, // or graphql.Int, graphql.Boolean, etc.
    resolve: (item, args, context) => someValue,
  }),
})
```

**After (OpenSaaS Stack):**

```typescript
fieldName: virtual({
  type: 'string', // see type mapping below
  hooks: {
    resolveOutput: ({ item, context }) => someValue,
  },
})
```

## Type Mapping

| Keystone `graphql.*`            | OpenSaaS `type`                            |
| ------------------------------- | ------------------------------------------ |
| `graphql.String`                | `'string'`                                 |
| `graphql.Int` / `graphql.Float` | `'number'`                                 |
| `graphql.Boolean`               | `'boolean'`                                |
| `graphql.list(graphql.String)`  | `'string[]'`                               |
| Custom object type              | `{ value: MyClass, from: 'package-name' }` |

For custom/imported types (e.g. Decimal):

```typescript
import Decimal from 'decimal.js'

totalPrice: virtual({
  type: { value: Decimal, from: 'decimal.js' },
  hooks: {
    resolveOutput: ({ item }) => new Decimal(item.price).times(item.quantity),
  },
})
```

## Context Queries Inside resolveOutput

If the original `resolve` used `context.query.*` or `context.db.*`, replace with `context.db.*`:

```typescript
// Before
resolve: async (item, _, context) => {
  return context.query.Post.count({ where: { author: { id: { equals: item.id } } } })
}

// After
resolveOutput: async ({ item, context }) => {
  return context.db.post.count({ where: { authorId: { equals: item.id } } })
}
```

## Steps

1. Read the config file to find all `virtual()` field definitions
2. For each virtual field:
   a. Identify the `graphql.*` type → map to the OpenSaaS `type` value
   b. Extract the `resolve` function body
   c. Rewrite as `hooks: { resolveOutput: ({ item, context }) => ... }`
   d. Replace any `context.query.*` calls with `context.db.*` equivalents
   e. Note: field arguments (`args`) are NOT supported — if the original used args, bake in a default or split into multiple fields
3. After all virtual fields are updated, remove any `graphql` imports from `@keystone-6/core` that are no longer used
4. Report: list each field that was changed and what the new definition looks like
