---
'@opensaas/stack-cli': patch
---

`opensaas dev` now refuses a config change that declares an extension pack the running Dev database did not load, telling you to restart, instead of writing its migration space and failing in Prisma.
