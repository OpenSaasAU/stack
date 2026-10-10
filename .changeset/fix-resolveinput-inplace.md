---
'@opensaas/stack-core': patch
---

A list `resolveInput` that mutates `resolvedData` in place no longer mutates the caller's `data` or has its hook-set keys gated as caller input.
