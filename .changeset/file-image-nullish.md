---
'@opensaas/stack-storage': patch
---

Fix file()/image() fields being required on create/update: their Zod schema now uses key-optionality (.nullish()) so an omitted field validates and stores null (Zod 4).
