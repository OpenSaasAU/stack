---
'@opensaas/stack-core': patch
---

Fix a synthetic back-relation include (`from_<List>_<field>`) bypassing the source relationship field's `read` access rule.
