---
'@opensaas/stack-ui': patch
'create-opensaas-app': patch
---

Fix admin UI behaviour agreed in the expectations review: unknown list URLs and trailing segments 404, a failed Dashboard count says "Count unavailable", a list page past the end moves to the last page, a filter chip notes "no field called …", the Filter builder reads "at least"/"greater than" when typed, the item page is titled with its label, delete names the item and confirms "Item deleted" on the list, an unreachable server says the save may or may not have happened, creating shows "Creating…", an image field shows the file its value holds and drops a stale preview, and a date-time picker opens on its current value.
