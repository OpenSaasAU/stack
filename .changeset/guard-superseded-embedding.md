---
'@opensaas/stack-core': patch
'@opensaas/stack-rag': patch
---

Fix a slow, superseded embedding generation overwriting a newer one: the write is now skipped unless the source text still matches what was embedded (`writePluginOwnedField` accepts `onlyIfUnchanged`).
