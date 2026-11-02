---
'@opensaas/stack-storage': patch
'@opensaas/stack-core': minor
---

`cleanupOnDelete`/`cleanupOnReplace` no longer delete an asset another row of the same list still references. Core adds `readPluginOwnedRows` to `@opensaas/stack-core/extend`.
