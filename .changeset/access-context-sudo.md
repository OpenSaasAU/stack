---
'@opensaas/stack-core': minor
---

`Plugin['runtime']` now receives a `sudo` helper as a second argument — `runtime(context, sudo)` — mirroring `StackContext.sudo()` one layer lower. Call `sudo().db` for reads/writes that must bypass access control but still run hooks, for example a plugin's identity lookup that shouldn't depend on the caller's own list access policy. `sudo` is a plain function argument, not a method on `context` (`AccessContext`) itself.
