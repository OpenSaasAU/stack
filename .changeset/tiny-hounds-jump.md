---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
---

Add a relationship-options read primitive: `getRelationshipOptions(context, config, relatedListKey, { search?, take?, selectedIds? })` returns a bounded, projected `{ id, label }[]` for relationship editors. It selects only `id` and the resolved label field (via `getLabelFieldName`), so no depth-5 auto-include ever runs; `search` filters via `contains` when the label field is text; results are ordered by the label field; and currently-selected `selectedIds` are always unioned into the result even when outside the `search`/`take` window. Operation-level `query` access on the related list still applies (denied → `[]`).

Also adds a `relationshipOptions` op on `context.serverAction` so hosts can resolve options from a client without a bespoke endpoint:

```typescript
await context.serverAction({
  listKey: 'Post',
  action: 'relationshipOptions',
  field: 'author',
  search: 'ada',
  take: 20,
  selectedIds: ['user-123'],
})
// => { success: true, data: [{ id: 'user-123', label: 'Ada Lovelace' }, ...] }
```

`getRelationshipOptions` is exported from `@opensaas/stack-core` and re-exported from `@opensaas/stack-ui` for server components that already hold a context.
