---
'@opensaas/stack-storage': patch
---

Fix `createStorageUtils().uploadFile`/`uploadImage` accepting invalid `validation`/`transformations` options (e.g. a string `maxFileSize`) and silently disabling validation instead of refusing.
