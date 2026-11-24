---
'@opensaas/stack-core': patch
---

Fix `bigInt` writes given a number or numeric string failing with a raw encode error; validation's coerced bigint now reaches the write.
