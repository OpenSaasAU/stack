---
'@opensaas/stack-storage': patch
---

`image()` now throws when `db.columns` is combined with `transformations`, instead of uploading variants it never records.
