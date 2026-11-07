---
'@opensaas/stack-storage': patch
---

Refuse whitespace and control characters in stored file/image urls, closing `"/\t/host"` resolving to another host.
