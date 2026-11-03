---
'@opensaas/stack-core': patch
---

Document and pin that an update with an empty resolved payload still runs `afterOperation`/`afterTransaction` (`committed`, `item === originalItem`).
