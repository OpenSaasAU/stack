---
'@opensaas/stack-ui': patch
'create-opensaas-app': patch
---

The admin list view no longer sends a field whose `read` rule denies the session for every row to the browser: its name, type, UI config, relationship ref, foreign key and label column are withheld.
