---
'@opensaas/stack-core': minor
'@opensaas/stack-rag': patch
---

A throwing `afterTransaction` hook is reported, never propagated

A committed write, and `context.transaction()`, now resolve even when an `afterTransaction` hook throws. The error goes to the new `onAfterTransactionError` config callback, or to `console.error` by default. A rejection always means the write did not persist. `AfterTransactionError` is removed.

```typescript
config({
  db: { provider: 'postgresql' },
  lists: {},
  onAfterTransactionError: ({ error, status, listKey, operation }) => {
    logger.error({ error, status, listKey, operation }, 'afterTransaction failed')
  },
})
```
