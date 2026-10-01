---
'@opensaas/stack-core': patch
---

`writePluginOwnedField` refuses a relationship field with `NoColumnsPluginFieldWriteError` instead of passing it to the ORM.
