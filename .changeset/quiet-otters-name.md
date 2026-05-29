---
'@opensaas/stack-core': patch
---

Split the access engine into named two-phase-read modules: Access Filter (pre-query), Field Visibility (post-query), and a shared field-access evaluator. No behaviour or public API change.
