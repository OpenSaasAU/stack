---
'@opensaas/stack-core': patch
---

MCP derived CRUD tool and custom tool failures (access denial, thrown engine/database errors, input schema validation) now return a successful JSON-RPC response with `result.isError: true` instead of a JSON-RPC `error` object, so the calling model can see and recover from them. Genuine protocol failures (unknown method, malformed request, unknown tool name) are unchanged. Note: the wire shape of tool failures changes — a consumer asserting on the old `error` shape will need to update.
