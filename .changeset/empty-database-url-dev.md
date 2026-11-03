---
'@opensaas/stack-cli': patch
---

`opensaas dev` now blanks `DATABASE_URL` and `DIRECT_DATABASE_URL` for the app child instead of deleting them, so `.env` can no longer point the app at a database the loop did not reconcile.
