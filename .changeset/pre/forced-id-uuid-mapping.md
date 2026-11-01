---
'@opensaas/stack-auth': patch
---

Fix magic-link, email-OTP and SIWE sign-in failing with a 500 because better-auth's non-UUID reservation id was written to a `uuid` id column; the Auth adapter now maps a non-conforming forced id to a deterministic UUID.
