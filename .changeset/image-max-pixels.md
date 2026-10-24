---
'@opensaas/stack-storage': patch
---

Refuse images over a pixel cap (`validation.maxPixels`, default 50 megapixels) on every `uploadImage`, before anything decodes them.
