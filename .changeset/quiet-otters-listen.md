---
'@opensaas/stack-core': patch
---

Fix: a `where`/`orderBy` nested inside a caller's `include` entry now validates against the related list's config, closing a probing oracle over undeclared or read-denied fields one hop into a relation (#1092).
