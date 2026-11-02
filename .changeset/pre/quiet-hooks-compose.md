---
'@opensaas/stack-storage': patch
---

`file()`/`image()` now compose a user `hooks.resolveInput`/`afterOperation` with the built-in ones instead of replacing them, so upload, the metadata-trust check and delete cleanup survive.
