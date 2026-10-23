---
'@opensaas/stack-rag': patch
---

`embedding()` honours `access.write: 'hooks'` and keeps only `read` and `allowCreateDefault` from a caller's access when manual writes are off.
