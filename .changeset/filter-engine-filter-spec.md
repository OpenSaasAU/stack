---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
---

Add the admin UI filter engine: a Filter spec field-builder contract and URL-driven server-side list filtering (ADR-0017).

Fields now declare their filtering capability through a new optional `getFilterSpec` method — a peer of `getPrismaType`/`getTypeScriptType` on the field-builder contract. It reports the operators a field supports, a pure token→condition mapper, and serializable suggestion metadata. Core field types implement it (text contains + free text, integer/decimal/timestamp/calendarDay comparisons, select/checkbox equality against enumerated values, relationship by label lookup). A field without a spec — `password`, `json`, `virtual`, or any third-party field that hasn't adopted one — is simply not filterable, so the addition degrades gracefully everywhere.

The admin list view now parses the URL filter query (the list's `search` param) through the engine and merges the result into the access-controlled query via the secured context, so filtering runs server-side and can only ever narrow — never widen — what a session may see. This replaces the previous hard-coded `type === 'text'` search; free-text behavior is now driven by each text field's Filter spec.

Grammar (ADR-0017): implicit-AND tokens, quoted multi-word values, `>`/`>=`/`<`/`<=` comparisons on numeric/date fields, and bare words as free text. Unknown syntax degrades to free text, never errors.

New exports from `@opensaas/stack-core`:

```typescript
import {
  parseFilterQuery, // (query) => FilterToken[]  — pure
  buildFilterWhere, // (tokens, specs) => where   — pure
  collectFilterSpecs, // (listConfig, listKey, config) => specs
  buildListFilterWhere, // (query, listConfig, listKey, config) => where
  collectFilterSuggestions, // serializable autocomplete metadata
} from '@opensaas/stack-core'

// e.g. "status:Published views:>10 author:\"Ada Lovelace\" beta"
const where = buildListFilterWhere(query, listConfig, listKey, config)
const rows = await context.db.post.findMany({ where }) // ANDed with the access filter
```

Third-party field authors can implement `FilterSpec` (exported from `@opensaas/stack-core/extend`) to make their field filterable.
