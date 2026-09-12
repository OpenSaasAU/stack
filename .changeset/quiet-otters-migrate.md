---
'@opensaas/stack-cli': minor
---

The migration assistant (`opensaas migrate --with-ai`, `opensaas_answer_migration`) no longer emits a Prisma 7 database block. `MigrationGenerator` now writes the Postgres-only `db: { provider: 'postgresql' }` block for both a fresh Prisma/Next.js migration and the KeystoneJS migration guide — no `prismaClientConstructor`, no driver adapter import, and no `joinTableNaming` guidance for a key that no longer exists. The Keystone guide's many-to-many step now shows a junction-list example instead, and the emitted next steps point at `pnpm generate`/`pnpm dev` instead of `prisma generate`/`prisma db push`.

A generate-and-validate test suite (`emitted-migration-surface.test.ts`) now covers the migration generator the same way `emitted-prisma-surface.test.ts` covers the feature wizard: every emitted config is parsed, swept for dead Prisma 7 surface, and run through the CLI's own pre-write validation chain.
