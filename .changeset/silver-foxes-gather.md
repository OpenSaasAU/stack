---
'@opensaas/stack-core': minor
---

Gate nested `connect` by the owning relationship field's field-level access

Nested `connect` (and the connect branch of `connectOrCreate`) is now gated by
the owning relationship field's create/update field-level access, in addition to
the target list's read/query access and DB-reachability check. This completes
the Keystone-parity rule that a connect requires both read access on the target
AND write access on the owning relationship field. `sudo` bypasses the check.

```typescript
Post: list({
  fields: {
    // A non-sudo caller can only connect an author when this field's
    // update access permits it (and the target User is readable/reachable).
    author: relationship({
      ref: 'User.posts',
      access: { update: ({ session }) => session?.role === 'editor' },
    }),
  },
})
```
