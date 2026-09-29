---
'create-opensaas-app': patch
---

Scaffolded server actions derive the session on the server instead of taking a caller-supplied `userId`, which any client could forge.
