---
'@opensaas/stack-core': patch
---

`context.serverAction` create/update/delete now returns only `{ id }` in `data`, so fields redacted with `ui.valueForClientSerialization` no longer reach the browser.
