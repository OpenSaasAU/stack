---
'@opensaas/stack-core': patch
---

Fix a denied to-many relation coming back `undefined` instead of `[]` on both the caller-`include:` and fragment `query` read paths.
