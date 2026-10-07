---
'@opensaas/stack-core': patch
---

`extendList` now throws when a plugin redeclares a field another plugin introduced, instead of silently discarding that field's access, hooks and options.
