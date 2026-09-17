---
'@opensaas/stack-auth': patch
---

Update the `Account.issuer` test and docs to match better-auth 1.7.4, which reverted the column it added in 1.7.0/1.7.1. No runtime behavior change — `deriveAuthLists` reads better-auth's own schema at derive time and already tracked the revert automatically.
