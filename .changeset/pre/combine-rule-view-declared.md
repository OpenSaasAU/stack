---
'@opensaas/stack-core': patch
---

Fix `combine()` rows branches bypassing the declared-dependency rule view, so `read` rules and `needs` hooks see unfiltered declared rows.
