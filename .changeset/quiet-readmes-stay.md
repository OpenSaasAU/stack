---
'@opensaas/stack-cli': patch
---

`opensaas migrate --with-ai` no longer overwrites an existing `.claude/README.md` (it is left as is, not refreshed), and always registers the GitHub marketplace source.
