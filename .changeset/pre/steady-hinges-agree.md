---
'@opensaas/stack-core': minor
---

Junction-edge detection, the delegate's singleton shape and write-field ownership now ask the List member resolver, so a context built over a config whose list or member names `opensaas generate` refuses throws generate's own error at construction. Generate still runs further checks that context construction does not.

**Migrating:** a test or script that builds a context over a hand-written config with names `opensaas generate` would refuse (for example a camelCase list key, or a list-only to-many) now fails at `getContext`/`createTestContext`. Fix the config so `pnpm generate` accepts it.
