---
'@opensaas/stack-auth': patch
---

Fix better-auth plugin schema extensions (e.g. `user`) resolving against a re-derived list key instead of the configured model-key remap, which could silently apply the extension's fields/access to an unrelated host list sharing the default key.
