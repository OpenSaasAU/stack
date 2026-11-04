---
'@opensaas/stack-auth': patch
---

`getSessionFromAuth` now omits a `sessionFields` entry resolved to `undefined` instead of passing it through — `getContext` refuses a session holding `undefined` for one of its own keys (#1397), and a resolved-but-unset custom field (e.g. from a `customSession` plugin) is a real signed-in session, not a malformed one.
