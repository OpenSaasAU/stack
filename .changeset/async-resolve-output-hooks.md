---
'@opensaas/stack-core': patch
---

Fix async resolveOutput hooks not being awaited in filterReadableFields

The `resolveOutput` hooks for fields (especially virtual fields) were being called but not awaited, causing Promise objects to appear in output instead of resolved values. This fix properly awaits async `resolveOutput` hooks using `Promise.resolve()` wrapper for backwards compatibility with sync hooks.
