---
'@opensaas/stack-core': patch
---

Clone object/array field `defaultValue`s when applying them so in-place mutation by a hook no longer leaks into later writes.
