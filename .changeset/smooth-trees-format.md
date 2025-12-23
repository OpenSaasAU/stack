---
'@opensaas/stack-cli': minor
---

Add automatic Prisma schema formatting after generation

The `opensaas generate` command now automatically runs `prisma format` after generating the schema file. This ensures consistent formatting of the generated `prisma/schema.prisma` file.

The formatting step is non-critical - if it fails (e.g., due to missing environment variables or network issues), generation will continue with a warning instead of failing.

No action required - formatting happens automatically during `pnpm generate`.
