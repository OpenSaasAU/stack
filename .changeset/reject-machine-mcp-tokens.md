---
'@opensaas/stack-auth': patch
---

Fix `createBetterAuthMcpAdapter` and `withMcpAuth` mapping a `client_credentials` token (`sub` equal to `client_id`/`azp`) to a signed-in session; such tokens now get a 401.
