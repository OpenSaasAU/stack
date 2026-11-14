---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
---

The admin list view reads the Session vocabulary for everything it offers

The column picker, default columns, Preset views and the Filter builder offer only fields the session can read, sorting follows each field's `sortable` answer, and a field with `isFilterable: false` is absent from every place a filter can be built. A row-dependent readable field stays shown but is neither filterable nor sortable (ADR-0031). Count links and filter-chip labels read the related list's vocabulary, so a related list whose `query` rule returns `false`, `null` or `undefined` gets no link and no label lookup.

`collectFilterSpecs`, `buildListFilterWhere`, `collectFilterSuggestions` and `isFieldFilterableById` now answer from the context's Session vocabulary, so each field rule is asked once per request and a `read` rule that throws denies that one field and is logged instead of failing the list:

```ts
const specs = await collectFilterSpecs(listConfig, 'Post', config, {
  session: context.session,
  context, // a context core built; any other gets no specs
})
```

The internal `_orderableKeys` context member and `collectUnreadableFields` are removed; read `context._sessionVocabulary(listKey)` instead (`fields.get(key)?.sortable`, `fields.get(key)?.read`).
