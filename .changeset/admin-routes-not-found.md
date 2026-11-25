---
'@opensaas/stack-ui': patch
'create-opensaas-app': patch
---

The admin returns a 404 for a URL naming no list or carrying segments after an item id, shows "Count unavailable" instead of "0 items" when a Dashboard count fails, and moves a list page past the end to the last page instead of showing "No items yet".
