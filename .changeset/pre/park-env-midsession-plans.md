---
'@opensaas/stack-cli': patch
---

`opensaas dev` against a `DATABASE_URL` database now parks every non-empty mid-session schema plan unless started with `--yes`; apply it with `pnpm db:update --plan <id>`.
