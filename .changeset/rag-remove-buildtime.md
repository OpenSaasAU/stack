---
'@opensaas/stack-rag': minor
---

Remove the `buildTime` option from `ragPlugin()`. It was accepted but never implemented; embeddings are always generated at runtime.
