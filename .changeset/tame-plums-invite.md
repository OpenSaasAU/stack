---
'@opensaas/stack-core': patch
---

Fix virtual fields named in `include`/`select` throwing a Prisma "Unknown field" error. Virtual field keys are now stripped from the query payload while their value is still computed via `resolveOutput`.
