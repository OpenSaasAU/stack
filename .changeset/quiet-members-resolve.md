---
'@opensaas/stack-core': patch
'create-opensaas-app': patch
---

Add an internal List member resolver that answers, once per list, what each usable name on a list is. No call site uses it yet.
