---
'@opensaas/stack-core': patch
---

Required json fields now reject a present `null` during validation rather than failing later as a DB NOT NULL violation. Omitted keys on update are still allowed; the Prisma column nullability is unchanged.
