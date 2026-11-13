---
'@opensaas/stack-cli': patch
---

`opensaas dev` booted without a TTY now parks a destructive plan, serves the previous bundle and names `pnpm db:update --plan <id>`; `--yes` never consents to data loss.
