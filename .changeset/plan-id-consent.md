---
'@opensaas/stack-cli': minor
'create-opensaas-app': patch
---

`opensaas db update` takes `--plan <id>` instead of `--confirm`: the loop prints a destructive plan with its id and applies it only if the plan it re-computes still has that id.
