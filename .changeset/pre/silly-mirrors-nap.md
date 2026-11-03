---
'@opensaas/stack-cli': patch
---

`generateCommand()` now throws `GenerationFailedError` on failure instead of calling `process.exit(1)`. `opensaas generate` catches it at the CLI entry point and exits 1 as before; `opensaas dev` catches it at boot and runs the loop's async `stop()`, so a generation failure closes the Dev database cleanly instead of orphaning it.
