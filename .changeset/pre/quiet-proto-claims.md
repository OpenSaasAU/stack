---
'@opensaas/stack-core': patch
'@opensaas/stack-auth': patch
---

MCP sessions no longer let a `__proto__` claim in an accepted JWT set the context session's prototype.
