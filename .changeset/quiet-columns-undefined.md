---
'@opensaas/stack-core': patch
---

Fix an explicit `undefined` on a `kind: 'columns'` field nulling every part column on update; it is now treated as omitted.
