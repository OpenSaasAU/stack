---
'@opensaas/stack-auth': patch
---

Lowercase the Auth user `email` on write through `context.db`, MCP and the admin, so a mixed-case email can sign in and cannot be duplicated by a lowercase sign-up.
