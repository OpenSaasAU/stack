---
'@opensaas/stack-storage': patch
---

Fix image variants without a `format` being stored under a composite extension (`photo.png-thumb`); they now take the original's extension (`photo-thumb.png`).

Variant filenames now take the extension from the content type, so `jpeg` variants are named `.jpg`; dots in a variant name become underscores.
