---
'@opensaas/stack-core': patch
---

Fix MCP `create`/`update` tools disclosing which fields a session may not write: a field withheld from the `data` schema now refuses with the byte-identical message a nonexistent field gets, instead of a distinct "field-level access denied" message.
