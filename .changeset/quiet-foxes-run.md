---
'@opensaas/stack-core': patch
---

Return a generic "Action failed" message (and log the real error server-side) when a custom bulk-action handler throws an unexpected non-Prisma error, instead of surfacing its internal message to the client
