---
'@opensaas/stack-core': patch
---

Fix `packages/core/CLAUDE.md` documenting the plugin runtime's `sudo()` helper as returning `AccessContext` — it returns `StackContext`.
