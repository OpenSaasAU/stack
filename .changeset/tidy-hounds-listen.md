---
'@opensaas/stack-ui': patch
---

Fix the relationship-table pre-linked create drawer showing the new row optimistically instead of depending on `router.refresh()` reliably observing the write it just made (#1376).
