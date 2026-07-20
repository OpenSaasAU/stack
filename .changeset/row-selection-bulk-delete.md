---
'@opensaas/stack-ui': minor
---

Add row selection and a built-in Bulk action Delete to the admin list view

The list table now renders a selection checkbox column when the list's delete
access is not statically false. The header checkbox toggles the visible page,
per-row checkboxes accumulate an explicit id set across pages, and the selection
clears when the filter changes. A selection bar shows the count, a Clear action,
a named `data-slot="selection-actions"` seam for future custom bulk actions, and
— only when delete access allows — a Delete that confirms first, deletes each
selected row through the secured context honouring Silent failure, and reports
"N of M deleted" (partial access denials are visible without revealing which or
why).

The admin list view also honours an optional `?pageSize=` URL param, preserved
across sorting, searching and paging.

New exports: `RowSelectionBar` (with `RowSelectionBarProps` /
`RowSelectionBarClassNames`) and the `useRowSelection` hook plus the pure
`isPageFullySelected` / `getPageCheckboxState` helpers.

```tsx
import { RowSelectionBar, useRowSelection } from '@opensaas/stack-ui'

const selection = useRowSelection('Post', filterKey)
<RowSelectionBar
  count={selection.selectedCount}
  onClear={selection.clear}
  onDelete={async () => {
    /* delete the selected ids through the secured context */
  }}
/>
```
