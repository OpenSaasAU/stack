---
'@opensaas/stack-cli': patch
---

Fix `opensaas dev` freezing on stale config after a failed load; `db update --plan <id>` now refuses a plan the current config no longer wants.
