---
'@opensaas/stack-core': patch
'@opensaas/stack-ui': patch
---

The Filter builder reads numeric dates in the viewer's locale order, and a date-only `lte`/range end on a timestamp covers its whole UTC day.
