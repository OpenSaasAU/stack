---
'@opensaas/stack-auth': patch
---

`extendUserList.fields` now throws at config time when it redeclares `email`, `name`, `image` or `emailVerified`, which previously dropped the unique index, `isRequired` and the lowercase hook on the identity column.
