---
'@opensaas/stack-cli': patch
---

Fix the generated `rawOpensaasContext` permanently rejecting for the rest of the process if the database wasn't reachable on its first construction attempt (e.g. a cold boot racing the database). It now retries on each `await`, like the client singleton it wraps.
