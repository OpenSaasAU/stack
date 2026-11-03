---
'@opensaas/stack-cli': patch
---

`opensaas dev` now passes `DATABASE_URL` and `DIRECT_DATABASE_URL` to the app child as empty strings instead of unsetting them, so `.env` cannot refill them and point the app at a database the loop did not reconcile. App code that tests these for `undefined` should test for an empty value.
