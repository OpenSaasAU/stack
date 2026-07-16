---
'@opensaas/stack-auth': minor
---

The derived `Session.user` and `Account.user` foreign keys now mirror a live better-auth database's shape: no `@@index([userId])` (better-auth carries no separate FK index) and `onDelete: Cascade` (Prisma's default was `Restrict`). This applies to both greenfield installs and adopted databases, so a generated Auth schema diffs clean against a standard better-auth Prisma schema.

Migration note: existing greenfield stack-auth apps will see a schema diff on next `pnpm generate` — a migration that drops the `userId` index on `Session`/`Account` and adds `onDelete: Cascade` to both foreign keys. Review the generated migration before applying it; deleting a user now cascades to their sessions and accounts instead of being blocked.
