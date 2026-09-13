---
'@opensaas/stack-core': patch
---

Delete the dead to-one access tree, its visibility resolver and the post-query null-forcing (`access-filter.ts`), now that the native include-based scoping fully replaced them. Internal cleanup only — no behavior change.
