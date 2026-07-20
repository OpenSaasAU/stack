---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
---

Add the Filter builder input UI for the admin list view (#731)

The admin list view now ships a `FilterBuilder` that constructs the `?search=`
filter query the filter engine already consumes (ADR-0017) — a free-text search
box plus structured field / operator / value rows. Available fields, operators,
and value suggestions are derived entirely from each field's self-contained
`getFilterSpec` (via the serializable `collectFilterSuggestions` metadata), so
there is no field-type `switch` and no functions cross the server/client
boundary. Applied filters flow through the same secured `context.db`, so
filtering can only ever narrow what a session may see.

`@opensaas/stack-core` gains `serializeFilterQuery(tokens)` — the exact inverse
of `parseFilterQuery` — so the builder produces the grammar the engine parses
with the quoting and operator-prefix rules kept next to the parser.

The `FilterBuilder` is composable (exported from `@opensaas/stack-ui` and
`@opensaas/stack-ui/standalone`) with theme-token styling and `data-slot` parts
for extension:

```tsx
import { FilterBuilder } from '@opensaas/stack-ui/standalone'
import { collectFilterSuggestions } from '@opensaas/stack-core'

// Server component: collect serializable suggestion metadata for the list.
const suggestions = collectFilterSuggestions(listConfig, 'Post', config)

// Client: build and apply a `?search=` query.
<FilterBuilder
  suggestions={suggestions}
  defaultValue={search}
  onApply={(query) => router.push(`/admin/post?search=${encodeURIComponent(query)}`)}
/>
```

The list view wires this in automatically; existing `?search=` URLs keep
working unchanged.
