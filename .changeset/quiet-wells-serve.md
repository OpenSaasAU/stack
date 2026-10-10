---
'@opensaas/stack-auth': patch
---

Security: `createOAuthDiscoveryHandler` and `createOAuthProtectedResourceHandler` now answer in-process through the Better Auth instance instead of fetching a request-derived URL with every inbound header forwarded.
