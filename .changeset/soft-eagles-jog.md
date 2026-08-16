---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
---

Fix a field-level `read` gate withholding a field's VALUE but leaving its PREDICATE unconstrained: a read-denied field could still be named in a `where`/`orderBy`, letting its value (or relative order) be recovered by probing — `count()` is the cleanest instrument, since it answers a predicate while returning no rows at all. `findMany`/`count` now reject a `where`/`orderBy` key naming a field the session cannot read (including nested inside `AND`/`OR`/`NOT`), throwing instead of returning a silently narrowed or empty result. A `read` rule that depends on the fetched row (`item`) cannot be evaluated before the query runs and now resolves to a denial rather than being skipped — see `docs/adr/0031-a-predicate-cannot-name-a-field-the-session-cannot-read.md`. `sudo` is unaffected.

This was independently reachable through the admin UI's own list view: `collectFilterSpecs`, `buildListFilterWhere`, and `collectFilterSuggestions` (`@opensaas/stack-core`) now take a required `{ session, context }` argument and return a `Promise`, excluding a read-denied field from the collected Filter specs so the UI never suggests, autocompletes, or submits a filter the engine is going to reject — a `field:value` token for such a field now degrades to free text instead. The list view's sort validation (`@opensaas/stack-ui`) excludes the same fields from what a `?sort=` URL param may activate.

```ts
// Before
const specs = collectFilterSpecs(listConfig, listKey, config)
const where = buildListFilterWhere(query, listConfig, listKey, config)
const suggestions = collectFilterSuggestions(listConfig, listKey, config)

// After — pass the session/context the field's `read` access is checked against
const specs = await collectFilterSpecs(listConfig, listKey, config, { session, context })
const where = await buildListFilterWhere(query, listConfig, listKey, config, { session, context })
const suggestions = await collectFilterSuggestions(listConfig, listKey, config, {
  session,
  context,
})
```
