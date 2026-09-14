---
'@opensaas/stack-cli': patch
---

Narrow the staged-promotion window in which `.opensaas/tables.ts` could disagree with `prisma/contract.ts`, and document `prisma.config.ts` always landing last as the stated promotion-complete signal (ADR-0072).
