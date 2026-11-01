---
'@opensaas/stack-cli': patch
---

`opensaas migrate --with-ai` now aborts instead of overwriting an unparseable `.claude/settings.json`, and records `postgresql` as the default provider.
