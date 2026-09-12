---
'@opensaas/stack-core': patch
---

Fix a rejected lazy Prisma import in `secured/lower.ts` being cached permanently — a transient import failure no longer poisons every later secured read for the life of the process; the next call retries, and a successful import is still cached.
