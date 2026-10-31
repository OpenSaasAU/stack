---
'@opensaas/stack-storage': patch
---

With `generateUniqueFilenames: false`, refuse an upload whose key another row already owns, and skip cleanup deletes of a file another row still references.
