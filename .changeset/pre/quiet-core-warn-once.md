---
'@opensaas/stack-core': patch
---

`context.db` writes now `console.warn` once per list and operation when the context has no transaction to join and no opener of its own, so a `getContext` built without a `client` no longer drops rollback silently.
