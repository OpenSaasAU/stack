---
'@opensaas/stack-core': patch
---

Fix a to-one relationship label filter emitting `contains` against `id` (and throwing a `ValidationError`) for a related list with no `name`/`title`/`ui.labelField`; the filter now declines instead.
