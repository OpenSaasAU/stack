---
'@opensaas/stack-core': patch
'create-opensaas-app': patch
---

The dependency table, synthetic back-relation lookup, multi-column read assembly and singleton checks read from the List member table; output is unchanged.
A multi-column field's parts now come from its `columns` descriptor, so one that implements no `getColumnNames` is still assembled on read.
