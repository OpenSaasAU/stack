---
'@opensaas/stack-core': patch
---

MCP now refuses malformed uuid/cuid ids in `where.id`, foreign-key columns and `connect.id` at the id boundary instead of letting them reach Postgres.
