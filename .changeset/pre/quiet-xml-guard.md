---
'@opensaas/stack-storage': patch
---

Refuse every `+xml` MIME type (e.g. `application/xslt+xml`, `application/rdf+xml`) as active content by default, not just the fixed blocklist.
