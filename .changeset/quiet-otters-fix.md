---
'@opensaas/stack-core': patch
---

Fix update validation rejecting omitted required fields under zod 4.4 by using key-optionality (`.optional()`) instead of `z.union([schema, z.undefined()])`. Partial updates that omit a required-on-create field now validate; present values still enforce their rules.
