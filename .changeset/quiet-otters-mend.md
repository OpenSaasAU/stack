---
'@opensaas/stack-core': patch
---

Fix `bindContextToTransaction` silently dropping `AccessContext` members it didn't explicitly list (e.g. `_config`) when rebuilding a hook's context inside a write's transaction. It now spreads the source context and overrides only what a transaction rebind must change.
