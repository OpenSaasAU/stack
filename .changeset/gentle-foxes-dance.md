---
'@opensaas/stack-core': minor
---

Add access control function shorthand to ListConfig

List configurations now support a function shorthand for access control that applies to all operations:

```typescript
// Instead of this:
Post: list({
  fields: { title: text() },
  access: {
    operation: {
      query: isAuthenticated,
      create: isAuthenticated,
      update: isAuthenticated,
      delete: isAuthenticated,
    },
  },
})

// You can now write:
Post: list({
  fields: { title: text() },
  access: isAuthenticated,
})
```

The `list()` function normalizes the shorthand to the object form at runtime, so existing code continues to work unchanged.

New exports:

- `ListAccessControl<T>` - Union type accepting either a function or operation object
- `ListConfigInput<TTypeInfo>` - Input type for `list()` function with flexible access control

Fixes #285.
