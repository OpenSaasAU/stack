---
'@opensaas/stack-cli': patch
---

`opensaas dev` now refuses a config change that declares an extension pack PGlite can load but the running Dev database did not (such as pgvector), telling you to restart instead of writing its migration space and failing in Prisma.
