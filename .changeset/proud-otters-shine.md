---
'@opensaas/stack-cli': patch
---

Fix multi-schema P1012: models without `db.schema` now default to `@@schema("public")` instead of emitting no `@@schema` (mirrors the enum default). Greenfield output is unchanged.
