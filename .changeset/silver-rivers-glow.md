---
'@opensaas/stack-core': patch
'@opensaas/stack-cli': patch
---

Prevent production database discovery and tracing from following Dev state into the project root; pass an explicit state path when the dev loop serves a production build.
