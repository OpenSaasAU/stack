---
'@opensaas/stack-cli': patch
---

Fix `opensaas dev`'s app-child spawn on Windows: the extended `PATH` is now written under the host's own `PATH`/`Path` casing, and a resolved `.cmd`/`.bat` shim (`next`, and any other project bin) launches through a shell instead of failing to spawn.
