---
'@opensaas/stack-core': patch
---

Security: admin `serverAction` and relationship actions no longer return a non-validation error's raw message to the client. Only `ValidationError`, `DatabaseError` and the engine's own refusals pass through; anything else is logged and replaced with a generic message. MCP shares the same predicate.
