---
'@opensaas/stack-cli': patch
---

Fix `opensaas migrate junction-ids` skipping junction lists declared with `foreignKey.map`; the planner now compares and emits physical column names.
