---
'@opensaas/stack-auth': patch
---

Keep `createdAt`/`updatedAt` on the auth lists now that auto-timestamps are off by default

The derived auth lists (User/Session/Account/Verification) now opt into `db: { timestamps: true }`. better-auth's adapter writes those columns and the schema converter returns `null` for them assuming the generator injects them, so the opt-in keeps the generated auth models intact.
