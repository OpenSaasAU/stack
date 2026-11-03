---
'create-opensaas-app': patch
---

Scaffolded server actions derive the session on the server instead of taking a caller-supplied `userId`, which any client could forge.

Examples without an auth provider (`starter`, `blog`, `custom-field`, `composable-dashboard`) use a demo session that acts as the first user; it is a stand-in for a real auth session, not an access boundary.
