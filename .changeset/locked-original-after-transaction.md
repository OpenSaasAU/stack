---
'@opensaas/stack-core': patch
---

`afterTransaction` on a root update or delete now receives the `originalItem` resolved under the row lock, not the pre-lock snapshot (`beforeTransaction` keeps the snapshot).
