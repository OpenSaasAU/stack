---
'@opensaas/stack-storage': patch
---

`acceptedExtensions` is now checked against the extensions of the effective MIME type (what the file is stored under), not the client filename, so `[".pdf"]` no longer admits an executable declared as `cv.pdf`. Behaviour change: a file whose filename extension disagrees with its declared type is now judged by the type.
