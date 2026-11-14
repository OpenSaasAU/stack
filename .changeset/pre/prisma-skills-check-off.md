---
'@opensaas/stack-cli': patch
---

The generated `prisma.config.ts` sets `skills: { check: false }`, which silences Prisma's "agent skills are out of date" notice on every command. Starter scaffolds gain a `lint` script (`tsc --noEmit`).
