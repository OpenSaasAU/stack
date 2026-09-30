---
'@opensaas/stack-core': patch
---

`sudo()` bare reads no longer null to-one foreign keys by the session's own access, so they agree with a sudo include.
