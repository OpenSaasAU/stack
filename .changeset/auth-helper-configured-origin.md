---
'@opensaas/stack-auth': patch
---

`postAuthEndpoint` takes its origin from better-auth's resolved base URL instead of `X-Forwarded-Host`/`Host`, so a spoofed host can no longer redirect a password-reset link and sign-in works on non-canonical hosts. It fails with a clear error when `BETTER_AUTH_URL` is unset.
