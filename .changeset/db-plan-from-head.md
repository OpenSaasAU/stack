---
'@opensaas/stack-cli': patch
---

Add `opensaas db plan`, which plans each migration from the head of the app migration graph instead of the `db` ref; the starters' `pnpm migrate` now runs it.
