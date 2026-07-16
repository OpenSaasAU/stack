---
'@opensaas/stack-core': minor
---

`AccessContext` (the `context` passed to hooks, access control functions, and a plugin's `runtime(context)` factory) now carries an optional `sudo()` method, mirroring `StackContext.sudo()` one layer lower. Use `context.sudo().db` for reads/writes that must bypass access control but still run hooks — for example a plugin's identity lookup that shouldn't depend on the caller's own list access policy.
