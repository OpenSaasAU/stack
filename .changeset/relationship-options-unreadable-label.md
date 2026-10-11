---
'@opensaas/stack-core': patch
'@opensaas/stack-ui': patch
---

Fix the relationship picker failing entirely when the session cannot read the related list's label field; it now orders by `id` and skips search.
