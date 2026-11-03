---
'@opensaas/stack-core': patch
---

Fix a filter token that can't be compiled or degraded to free text (e.g. an unsupported operator on a list with no free-text field) silently widening the result set instead of matching no rows.
