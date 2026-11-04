---
'@opensaas/stack-storage': patch
---

`maxFileSize` is now enforced against the bytes actually read, not only the File-like's declared `size`.
