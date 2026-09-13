---
'@opensaas/stack-cli': patch
---

Fix the generated `Remainder`'s `computed`/`output` placement for a field whose contract descriptor is `kind: 'computed'` but does not also set the `virtual` flag — it now lands in `computed` by descriptor kind, matching the self-containment gate.
