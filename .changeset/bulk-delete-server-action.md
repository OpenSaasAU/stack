---
'@opensaas/stack-core': minor
---

Add a `bulkDelete` server action for list-level bulk deletion

`context.serverAction` now accepts `{ listKey, action: 'bulkDelete', ids }`. It
deletes each id row-by-row through the secured context, honouring Silent failure
(a denied or missing row returns `null` and is not counted; one row's error does
not abort the rest), and returns `{ deleted, total }`.

The result is deliberately a count shape rather than the single-op `{ success }`
shape, so a UI `serverAction` wrapper that redirects on a single-item success
(the item-form pattern) does not hijack a list-level bulk operation.

```ts
const result = await context.serverAction({
  listKey: 'Post',
  action: 'bulkDelete',
  ids: ['a', 'b', 'c'],
})
// result: { deleted: 2, total: 3 }  // one row was denied/missing
```
