---
'@opensaas/stack-ui': patch
---

Defer the to-many "Link existing" control's far-endpoint options fetch to its first open instead of reading up to 50 rows per section on every item-view render.
