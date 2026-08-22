---
'@opensaas/stack-auth': patch
---

Read-denied credential fields (ADR-0036) now also declare `ui.listView.defaultColumn: false`, so they're curated out of the admin's default table columns instead of rendering as permanently empty columns.
