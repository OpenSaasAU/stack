---
'@opensaas/stack-cli': patch
'@opensaas/stack-core': patch
'create-opensaas-app': patch
---

Fix `opensaas generate` failing with "gen is not defined" when a config uses the `cuid` id strategy and no list uses `uuid7`, `cuid2` or `updatedAt`
