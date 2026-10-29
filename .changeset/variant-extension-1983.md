---
'@opensaas/stack-storage': patch
---

Fix image variants without a `format` being stored under a composite extension (`photo.png-thumb`); they now take the original's extension (`photo-thumb.png`).
