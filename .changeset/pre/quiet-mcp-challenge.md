---
'@opensaas/stack-core': minor
---

`createMcpHandlers` accepts an optional `resourceMetadataUrl`; when set, the 401 `WWW-Authenticate` challenge carries `resource_metadata` (RFC 9728) so MCP clients can discover the authorization server.
