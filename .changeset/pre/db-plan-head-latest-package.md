---
'@opensaas/stack-cli': patch
---

`opensaas db plan` plans from the latest package's target, so adding then removing a field no longer leaves the migration graph without a head.
