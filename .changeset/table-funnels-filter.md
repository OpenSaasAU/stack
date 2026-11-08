---
'@opensaas/stack-ui': minor
---

Filter from the table: header and value funnels, auto-shown filtered columns, and a zero-results empty state that names the filter to remove

- A filterable column header has a funnel ("Filter by Status") that opens the Filter builder with that field staged.
- A select value or a to-one relationship value has a funnel beside its Cell ("Filter to Status is Draft") that adds `status:draft` or `author:#<id>` to the current query. On an open Preset view it expands the preset first. The Cell registry and custom Cells are unchanged.
- A field the query filters on is shown as a column for that render even when `?columns=` hides it. It is never written to `?columns=`.
- When a query returns no rows, the list view counts the first five terms, each with one secured `context.db` count, and offers the removal that returns the most rows: "Remove “Status is Draft” to see 12 rows". **Clear filters** (previously **Clear search**) is always offered.

`FilterBuilder` takes a `ref` exposing `startFilter(field)`, `currentQuery()`, `addTokens(tokens)` and `applyQuery(query)`. The table's funnels and the removal button go through it, so a chip committed while its navigation is still pending is kept:

```tsx
import { FilterBuilder, type FilterBuilderHandle } from '@opensaas/stack-ui/standalone'

const builder = React.useRef<FilterBuilderHandle>(null)

<FilterBuilder ref={builder} suggestions={suggestions} onApply={apply} />
<button onClick={() => builder.current?.startFilter('status')}>Filter by status</button>
```

`ListViewClient` gains the `autoColumns` and `filterRemoval` props. `autoColumns` are shown after `columns` and never become the row's title column. New slots: `list-view-header-filter`, `list-view-value-filter`, `list-view-value-filter-button` and `list-view-empty-remove`.
