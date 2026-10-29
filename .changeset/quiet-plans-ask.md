---
'@opensaas/stack-cli': minor
---

`opensaas dev` no longer applies schema changes to a database named by `DATABASE_URL` at startup without consent: it prints the plan and its id and stops. Pass `opensaas dev --yes` to apply it. The Dev database is unchanged.
