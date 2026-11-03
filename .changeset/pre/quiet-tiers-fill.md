---
'@opensaas/stack-auth': patch
---

`sessionFields` entries that better-auth's session lacks but the user list carries (such as an `extendUserList` field) are now read from the signed-in user's own row, so the documented `role`/`tier` recipe works. A `sessionFields` entry that resolves nowhere now throws at startup instead of warning at runtime.
