---
'@opensaas/stack-core': patch
---

Harden the test harness's pgvector probe: it now redials a server that is not accepting connections yet and throws once the deadline passes, so an unreachable server can never be recorded as one without pgvector
