---
'@opensaas/stack-core': minor
---

Add `filterSuggestionsOf(specs)`, which turns Filter specs already collected with `collectFilterSpecs` into the Filter builder's suggestions, so a caller that also builds a `where` from those specs evaluates each field's `read` rule once.

```ts
import {
  buildFilterWhere,
  collectFilterSpecs,
  filterSuggestionsOf,
  parseFilterQuery,
} from '@opensaas/stack-core'

const specs = await collectFilterSpecs(listConfig, 'Post', config, { session, context })
const suggestions = filterSuggestionsOf(specs)
const where = buildFilterWhere(parseFilterQuery(search), specs)
```
