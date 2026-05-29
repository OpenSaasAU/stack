---
'@opensaas/stack-core': patch
---

Deduplicate field-level hook execution helpers by promoting them to `hooks/index.ts`, and remove a stray `console.log` that ran on every create/update.
