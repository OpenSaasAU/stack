---
'@opensaas/stack-auth': patch
---

Throw at config time in production when password reset or email verification is enabled without a send callback, instead of logging the token URL.
