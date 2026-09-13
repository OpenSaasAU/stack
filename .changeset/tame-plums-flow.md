---
'@opensaas/stack-core': patch
---

MCP `tools/list` no longer advertises a `create` tool a session can never use: a row-independent `access.operation.create` denial now drops the tool, and a `db: { isNullable: false }` required field is now classified the same as `validation.isRequired`.
