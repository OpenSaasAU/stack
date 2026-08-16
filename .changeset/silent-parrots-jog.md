---
'@opensaas/stack-auth': patch
---

Fix the better-auth schema converter mapping a `bigint: true` field attribute to a 32-bit `Int` instead of a `BigInt` column, which silently overflowed on values like a millisecond epoch.
