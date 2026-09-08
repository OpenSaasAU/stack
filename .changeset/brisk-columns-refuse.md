---
'@opensaas/stack-core': minor
---

A denied write to a multi-column field now throws instead of silently dropping the key

`splitMultiColumnFields` — the phase that turns a multi-column field's logical value into
its physical columns — dropped the key and continued when field-level write access denied
it, so the write "succeeded" while doing less than asked. `filterWritableFields` has
thrown for a denied single-column field since #568; this brings the multi-column path in
line with it.

```typescript
// A field whose write is denied — @opensaas/stack-storage's multi-column
// image()/file(), or @opensaas/stack-rag's embedding()
await context.db.Article.update({
  where: { id },
  data: { contentEmbedding: myVector },
})
// Before: resolved successfully, and the vector was discarded.
// Now:    throws ValidationError
//         'Cannot update "contentEmbedding": field-level access denied.'
```

Sudo is unchanged: `checkFieldAccess` returns `true` under sudo, so an elevated write never
reaches the throw. A caller that relied on the silent drop to pass a denied field through
an ordinary write must stop sending the key, or write under `sudo()`.
