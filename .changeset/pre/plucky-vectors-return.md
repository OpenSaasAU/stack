---
'@opensaas/stack-rag': patch
---

Fix pgvector semantic search calling `$queryRawUnsafe` without its receiver, which turned every search into a `TypeError` instead of a query.
