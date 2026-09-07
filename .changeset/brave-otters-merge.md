---
'@opensaas/stack-core': minor
---

A plugin's hooks survive on a list that declares hooks of its own

`extendList`'s hook merge copied only `resolveInput`, `validateInput`, `beforeOperation`
and `afterOperation`. When a list declared any hook itself, every other kind a plugin
added — `validate`, `beforeTransaction`, `afterTransaction` — was dropped on the floor, so
the plugin's side of the list silently stopped running:

```typescript
Article: list({
  fields: { content: searchable(text()) },
  // Before: this one hook made ragPlugin's afterTransaction disappear, and the
  // row was persisted with a null embedding, with nothing said.
  hooks: { resolveInput: async ({ resolvedData }) => resolvedData },
})
```

All hook kinds now merge, the list's own running first and the plugin's after it — the
order `resolveInput` already used.
