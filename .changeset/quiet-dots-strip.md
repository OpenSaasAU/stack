---
'@opensaas/stack-storage': patch
---

Fix stored XSS where a double-extension upload (`invoice.html.pdf`) with an unknown MIME type was stored as `.html` by the local provider.
