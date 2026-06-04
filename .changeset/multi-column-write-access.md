---
'@opensaas/stack-core': patch
---

Fix field-level write-access bypass for multi-column `image()`/`file()` fields. The per-part column split now respects the field's own `create`/`update` access (denied fields write none of their columns), matching single-column behaviour.

Note the known lossy multi-column round-trip when assembling legacy Keystone columns: `originalFilename` collapses to `filename`, `uploadedAt` is `''`, and a NULL `contentType` reads back as `application/octet-stream`.
