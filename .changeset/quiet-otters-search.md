---
'@opensaas/stack-core': patch
---

Fix relationship live-search 500 when the target list's label field is a virtual field by ordering by `id` instead of the non-orderable virtual column
