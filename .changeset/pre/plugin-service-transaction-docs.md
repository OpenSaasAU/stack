---
'@opensaas/stack-core': patch
---

Document that plugin services are not transactional and that a service called from a hook takes the hook's `context` to join its transaction (#2165).
