---
'@opensaas/stack-core': patch
'@opensaas/stack-cli': patch
'create-opensaas-app': patch
---

Fix the session vocabulary keeping stale answers: a successful write or committed transaction clears it, `rawOpensaasContext` keeps nothing, and a `resolveOutput` hook no longer waits on its own pending answer.
