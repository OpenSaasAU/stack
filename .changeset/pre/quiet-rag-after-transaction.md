---
'@opensaas/stack-rag': patch
---

The RAG plugin's `afterTransaction` failures now reach `onAfterTransactionError` instead of the plugin's own logging.
