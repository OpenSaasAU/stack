---
'@opensaas/stack-core': patch
---

Declared `createdAt`/`updatedAt` fields are now ordinary fields (access, hooks, defaults apply and writes persist); `id` and auto-timestamps in a write payload now throw instead of being silently dropped.
