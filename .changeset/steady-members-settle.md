---
'@opensaas/stack-core': patch
'create-opensaas-app': patch
---

The dependency table, synthetic back-relation lookup, multi-column read assembly and singleton checks read from the List member table, so generated contracts and tables are unchanged.
A multi-column field is now assembled from its `columns` descriptor even without `getColumnNames`, and Field Visibility always resolves the list it reads, so a denied multi-column field's raw part columns never pass through.
