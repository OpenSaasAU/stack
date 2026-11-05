---
'@opensaas/stack-core': patch
---

Validate `decimal` precision/scale and the `defaultValue` of `checkbox`, `integer`, `bigInt`, `decimal`, `select` and `calendarDay` when the contract is derived, failing `opensaas generate` with an error naming the list, field and option.
