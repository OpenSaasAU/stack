---
'@opensaas/stack-cli': patch
'create-opensaas-app': patch
---

Fix `opensaas generate` failing with "gen is not defined" when every list uses `db.idField: 'cuid'` with no timestamps
