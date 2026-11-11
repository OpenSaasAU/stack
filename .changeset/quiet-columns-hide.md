---
'@opensaas/stack-ui': patch
'@opensaas/stack-core': patch
'create-opensaas-app': patch
---

The admin list's column picker, `?columns=` and default columns omit a field whose `read` rule denies the session for every row, matching the MCP vocabulary.
