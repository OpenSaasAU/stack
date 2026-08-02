---
'@opensaas/stack-core': patch
---

Fix `needs` declarations being dropped beneath a caller-named relation that revisits a list (e.g. `include: { author: { include: { posts: true } } }`, or a self-referential `parent`), which left the revisited list's computed fields resolving over `undefined`.
