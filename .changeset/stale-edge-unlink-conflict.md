---
'@opensaas/stack-core': patch
'@opensaas/stack-ui': patch
---

Fix a stale item form's to-many deselect silently reverting a concurrent re-point of the related row. `removeRelated`'s disconnect now locks the row and compares its current back-reference against the form's baseline, refusing the unlink (with an error the form surfaces) instead of nulling a link someone else just wrote.
