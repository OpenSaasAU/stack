---
'@opensaas/stack-core': patch
---

Redact raw error text from MCP `create`/`update`/`delete` tool responses when a field-level access rule throws while Field Visibility filters the write's own result, matching the fix already applied to the `query` path in #1361.
