---
'@opensaas/stack-core': patch
---

`bindContextToTransaction` now spreads the source `AccessContext` and overrides only what a transaction rebind must change, instead of rebuilding it by listing every member by hand — a shape that silently drops whichever member the next one forgets to add to the list.
