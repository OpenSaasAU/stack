---
'@opensaas/stack-core': minor
---

Add a label seam for the admin UI: `getLabelFieldName(listConfig)` resolves the field that represents a list's rows as a single label (`ui.labelField` → `name` → `title` → `id`), and `getItemLabel(listConfig, item)` reads that field off a row, falling back to `id` when it's missing. Both are exported from the root entry point.

```typescript
import { getLabelFieldName, getItemLabel } from '@opensaas/stack-core'

Post: list({
  fields: { title: text() },
  ui: { labelField: 'title' },
})

getLabelFieldName(listConfig) // 'title'
getItemLabel(listConfig, item) // item.title, or item.id if title is missing
```
