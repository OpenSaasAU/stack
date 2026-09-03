---
'@opensaas/stack-core': minor
---

A list/field `resolveInput` / `validate` / `beforeOperation` / `afterOperation` hook's `context` is now a full secured context — `sudo()`, `withSession()`, `transaction()` and `serverAction` — bound to the write's OWN transaction client, exactly like the `txContext` a `context.transaction()` callback receives.

```typescript
Order: list({
  hooks: {
    beforeOperation: async ({ context }) => {
      // Elevated AND atomic with this write — rolls back together if it throws.
      await context.sudo().db.auditLog.create({ data: { action: 'order-write' } })
    },
  },
})
```

Previously this `context` had no `sudo()`/`withSession()`/`transaction()` at all, forcing a workaround (`getContext(session).sudo()`) that opened a SEPARATE connection from the write's transaction — its writes could survive a rollback, and it could deadlock on a single-connection adapter. `context.transaction()` called from inside one of these hooks now joins the write's transaction rather than opening a nested one. `beforeTransaction`/`afterTransaction` and a field's `resolveOutput` are unaffected — they keep the plain access-checked context bound to the base client.
