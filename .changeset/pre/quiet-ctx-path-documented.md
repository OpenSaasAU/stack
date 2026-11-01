---
'@opensaas/stack-core': patch
---

Named the `ctx.runtime` path a collection carries off both `unsafe.orm` and `AccessContext.ormHandle` in the Unsafe surface's `Known limits`, corrected prose that overclaimed `prepare()`/`runtime()` as unreachable rather than "not among the surface's own members", and added a test pinning the reachability and tripwire behavior of `ctx.runtime` and `runtime.connection()`.
