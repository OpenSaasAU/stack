---
'@opensaas/stack-auth': patch
'@opensaas/stack-cli': patch
---

Scaffolded sign-in, sign-up and password-reset actions now go through `auth.handler` via the new `postAuthEndpoint`, so rate limiting applies.
