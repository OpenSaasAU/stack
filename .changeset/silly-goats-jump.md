---
'@opensaas/stack-cli': patch
---

Fix misleading doc comment on the generated `rawOpensaasContext` export: it's a `Promise<Context>` meant to be passed to a lazy-Proxy consumer (e.g. `createAuth`), not a synchronous value.
