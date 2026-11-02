---
'@opensaas/stack-core': patch
'@opensaas/stack-cli': patch
---

Fix a computed field (`{ kind: 'computed' }`, e.g. from a third-party field builder) that omits core's `virtual` flag: its `resolveOutput` now runs on read (it silently never ran before), and the generated `needs`/`NeedsItem` types are produced for it, matching a flagged `virtual()` field.
