---
'@opensaas/stack-ui': patch
---

Fix `ui.listView.initialSort` applying sort client-side instead of as a DB-level `orderBy`

Previously, `initialSort` was applied to the already-fetched page in memory, meaning a 500-row list with `initialSort: { field: 'sentAt', direction: 'desc' }` would only show the 50 most recent rows of the *current page* rather than the 50 most recent rows overall. The sort is now passed as `orderBy` to `findMany` so pagination and sorting compose correctly.

Column-header clicks also now navigate with a `?sort=field:direction` URL param (instead of mutating local state), so subsequent sorts are also DB-level and work correctly across pages.
