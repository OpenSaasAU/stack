---
'@opensaas/stack-core': patch
---

MCP endpoint: GET and DELETE now return 405 with `Allow: POST`, and a malformed JSON body returns a JSON-RPC -32700 parse error with status 400 instead of 500.
