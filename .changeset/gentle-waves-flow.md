---
'@opensaas/stack-core': patch
---

Fix infinite loop when virtual field resolveOutput hooks make database queries

When a virtual field's resolveOutput hook called context.db methods, it could cause an infinite loop if the query included relationships back to the original entity. This is now prevented by tracking resolveOutput hook execution depth and skipping auto-inclusion of relationships when inside a hook.
