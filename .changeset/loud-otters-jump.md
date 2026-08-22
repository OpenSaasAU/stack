---
'@opensaas/stack-core': minor
---

`OperationAccess.create` now throws `InvalidCreateAccessResultError` when the rule returns anything other than `true`/`false` — most notably a Prisma filter, which previously fell through the `create` access check unrecognised and was silently treated as a full allow (both the top-level write pipeline and nested-create paths were affected).

Create has no existing row to scope a filter against, so a filter can no longer be honoured here:

```typescript
// Before: type-checked, read as row-scoped, actually allowed everyone
create: ({ session }) => ({ ownerId: { equals: session.userId } })

// Now throws InvalidCreateAccessResultError. Scope ownership in a hook instead:
hooks: {
  resolveInput: async ({ resolvedData, context, operation }) => {
    if (operation === 'create') {
      return { ...resolvedData, ownerId: context.session?.userId }
    }
    return resolvedData
  },
},
access: {
  operation: {
    create: ({ session }) => !!session, // boolean only
  },
},
```

`create: () => false` still denies via Silent failure as before; only a non-boolean result now throws.
