---
'@opensaas/stack-core': patch
'@opensaas/stack-cli': patch
'@opensaas/stack-auth': patch
'@opensaas/stack-rag': patch
'@opensaas/stack-ui': patch
---

Upgrade to Prisma ORM 8.0.0-rc.17 (CLI rc.22); `opensaas db update --plan <id>` now consents with `--delete`/`--allow` per subject instead of `--confirm`.
Run Prisma's `data-type-in-contract` upgrade script and `pnpm generate` to re-emit committed contracts.
