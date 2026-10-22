---
'@opensaas/stack-core': patch
---

A nested include or order on a declared relation no longer leaks two-hop or read-denied data into a `resolveOutput` hook's `item`.
