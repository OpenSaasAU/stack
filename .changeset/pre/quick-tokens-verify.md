---
'@opensaas/stack-auth': patch
'@opensaas/stack-core': patch
---

Fix MCP OAuth never authenticating: `createBetterAuthMcpAdapter` and `withMcpAuth` now verify the bearer JWT via `@better-auth/mcp` (signature, issuer, audience, expiry) instead of calling the removed `auth.api.getMcpSession`. They take `{ resource, baseURL }` in place of the auth instance. `createAuth()` now throws on a missing `auth.api.*` member instead of resolving `undefined`.
