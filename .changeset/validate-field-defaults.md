---
'@opensaas/stack-core': patch
---

Validate `decimal` precision/scale and every built-in field's `defaultValue` when the contract is derived, failing `opensaas generate` with an error naming the list, field and option.
