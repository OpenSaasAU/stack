---
'@opensaas/stack-storage': patch
---

`acceptedExtensions` is now checked against the extension the file is stored under (from its effective MIME type), not the client filename, so `['.pdf']` no longer admits an executable declared as `cv.pdf`.
