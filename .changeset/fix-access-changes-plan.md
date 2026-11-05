---
'@opensaas/stack-cli': patch
---

Fix the dev loop reading `accessWidening` instead of the `accessChanges` the Prisma CLI reports, so access changes now count as destructive and reach the plan id and `--allow`.
