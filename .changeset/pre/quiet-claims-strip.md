---
'@opensaas/stack-auth': patch
---

The better-auth MCP adapter no longer forwards registered JWT claims (`iss`, `aud`, `nbf`, `iat`, `jti`, `azp`, `client_id`, `sid`) into the session access rules see; custom claims still pass through.
