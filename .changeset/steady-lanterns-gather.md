---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
---

The admin list view reads the Session vocabulary for everything it offers

The column picker, default columns, Preset views and the Filter builder offer only fields the session can read, sorting follows each field's `sortable` answer, and a field with `isFilterable: false` is absent from every place a filter can be built. A row-dependent readable field stays shown but is neither filterable nor sortable (ADR-0031). Count links and filter-chip labels read the related list's vocabulary, so a related list whose `query` rule returns `false`, `null` or `undefined` gets no link and no label lookup.

A session denied the list's `query` now sees an explicit "can't be shown here" state instead of an empty table, and keeps the Create button when it may still create (a write-only inbox). A Preset view's search drops every token naming a field the session cannot filter by (a never-readable or row-dependent field, or `isFilterable: false`), and a context that resolves no Session vocabulary shows the list's "could not be loaded" state instead of failing the page.

`collectFilterSpecs`, `buildListFilterWhere`, `collectFilterSuggestions` and `isFieldFilterableById` now answer from the context's Session vocabulary, which builds each Filter spec once per request: a `read` rule or a spec builder that throws denies that one field and is logged instead of failing the list. They answer for the context's own session and config, so `FilterAccessArgs` no longer takes a `session`, and `listConfig` and `config` must be the context's own. A context core did not build gets no specs and no throw:

```ts
const specs = await collectFilterSpecs(listConfig, 'Post', config, { context })
```

A throw carrying a string `digest` (Next.js's `redirect()`, `notFound()` and dynamic-usage bailouts) now propagates out of the Session vocabulary and the MCP vocabulary instead of being treated as a deny, so a rule that redirects still redirects.

The internal `_orderableKeys` context member and `collectUnreadableFields` are removed; read `context._sessionVocabulary(listKey)` instead (`fields.get(key)?.sortable`, `fields.get(key)?.read`).
