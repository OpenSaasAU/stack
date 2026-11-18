---
'@opensaas/stack-core': minor
---

Junction-edge detection, the delegate's singleton shape and write-field ownership now ask the List member resolver, so a context built over a config `opensaas generate` refuses throws generate's own error at construction.

**Migrating:** a test or script that builds a context over a hand-written config `opensaas generate` would refuse (for example a camelCase list key, or a list-only to-many) now fails at `getContext`/`createTestContext`. Fix the config so `pnpm generate` accepts it.
