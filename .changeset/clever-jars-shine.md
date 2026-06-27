---
'@opensaas/stack-core': patch
---

Enforce required json fields on create: an omitted key is now rejected while any
present value (object, array, primitive, or null) is still accepted.
