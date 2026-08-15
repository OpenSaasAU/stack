---
'@opensaas/stack-core': minor
---

Fix a fail-open bug where a field-level access rule returning a Prisma filter (instead of a boolean) silently granted the field full access. `checkFieldAccess` now throws `InvalidFieldAccessResultError` for any non-boolean result instead of defaulting to allow.

This narrows `FieldAccessControl`'s return type from `boolean | PrismaFilter | Promise<...>` to `boolean | Promise<boolean>` — field-level access was already documented (ADR-0001) to be boolean-only; the type had drifted from that. If a field rule returned a filter, it will now fail to compile (or throw at runtime for untyped/JS configs) instead of silently granting access. Evaluate the condition yourself and return a boolean instead, e.g.:

```ts
// Before (silently granted full access on read/write)
someField: text({
  access: {
    update: ({ session }) => ({ ownerId: { equals: session?.userId } }),
  },
})

// After
someField: text({
  access: {
    update: ({ session, item }) => !!session && session.userId === item?.ownerId,
  },
})
```

See `docs/adr/0030-field-level-access-fails-closed-on-a-non-boolean-result.md` for the full reasoning.
