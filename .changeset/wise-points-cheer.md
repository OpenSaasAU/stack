---
'@opensaas/stack-cli': patch
---

Fix `tsc` failure in generated `prisma-extensions.ts` for multi-column storage fields in `db: { columns: 'keystone' }` mode. The result extension's `needs` now references the physical part columns (e.g. `image_url`, `image_pathname`, …) derived from the field's `getColumnNames`, instead of the logical field name which has no scalar on the model (previously typed `true` against `never`). This removes the last error forcing `@ts-nocheck` on the generated bundle (#559).
