---
'@opensaas/stack-core': patch
---

A field's `afterOperation` hook now runs on create and update only when the field is in the write, matching `beforeOperation`. Delete still runs every field's hook, and `afterTransaction` stays ungated.
