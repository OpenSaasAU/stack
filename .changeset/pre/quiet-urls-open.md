---
'@opensaas/stack-storage': patch
'@opensaas/stack-ui': patch
---

Refuse stored file/image metadata `url`s that are not http(s) or absolute paths, and open them from the admin with `noopener,noreferrer`.
