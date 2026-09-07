---
'@opensaas/stack-core': patch
'@opensaas/stack-cli': patch
---

Fix `context.db.<list>.findUnique`/`findFirst`/`findMany` (and singleton `get`) in the generated `CustomDB` silently losing fragment narrowing: passing a `query` fragment compiled but the result stayed typed as the unnarrowed list payload instead of `ResultOf<typeof fragment>`. These methods now carry the same fragment overload as core's `AccessControlledDB`, so an unselected field is a compile error on the result.
