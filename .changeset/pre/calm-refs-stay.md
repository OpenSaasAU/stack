---
'@opensaas/stack-cli': patch
---

The dev loop no longer moves the committed `migrations/app/refs` once a migration package exists, so `pnpm migrate` keeps working after a dev reconcile.
