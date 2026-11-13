---
'@opensaas/stack-ui': patch
'@opensaas/stack-core': patch
---

Item forms, the singleton editor, relationship tables and preset searches no longer send never-readable fields the session also cannot write to the client, and preset searches drop tokens naming never-readable fields (#2292). A never-readable but writable field stays as a write-only control, per the triage decision.
