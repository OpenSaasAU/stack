---
'@opensaas/stack-core': minor
'@opensaas/stack-auth': minor
---

`McpSessionProvider` receives the incoming `Request`

`createBetterAuthMcpAdapter` verified every token against a synthetic `POST` to the resource, so a DPoP-bound token with a correct proof was rejected on the MCP `GET` and `DELETE` routes. The provider now gets the real request and verifies against its method and URL, without consuming the body.

Migration: `getSession: (headers) => …` becomes `getSession: (req) => … req.headers …`.
