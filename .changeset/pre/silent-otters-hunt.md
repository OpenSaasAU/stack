---
'@opensaas/stack-auth': patch
---

Fix a `databaseHooks` hook (e.g. `user.create.before`) reading or writing through `context.context.adapter` during sign-up hanging on the Dev database's single connection, or reading outside the transaction on pooled Postgres. The Auth adapter's root instance now shares the transaction-bound instance's lane for the life of the transaction.
