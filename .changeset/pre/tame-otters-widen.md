---
'@opensaas/stack-core': patch
---

Fix a regression from the previous MCP redaction fix (#1459): `DatabaseError` (and its `UniqueConstraintViolation`/`SerializationFailure` subclasses) and `ResolveOutputCycleError` are safe, framework-authored messages and are now allowlisted again on the MCP `create`/`update`/`delete` path instead of being flattened to a generic "failed due to an internal error" message.
