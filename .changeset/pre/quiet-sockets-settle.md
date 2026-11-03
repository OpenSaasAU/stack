---
'@opensaas/stack-core': patch
---

Fix the Dev database's `stop()` closing PGlite before the socket server's asynchronous client detach finished, which threw an unhandled `_IsTransactionBlock` error after shutdown.
