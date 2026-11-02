---
'@opensaas/stack-auth': minor
---

`User.email`, and `User.phoneNumber` / `User.username` when their plugins are registered, now ship update-denied on `context.db`, closing a session-confusion path via the owner-update rule. Reopen with `authPlugin({ fieldAccess })`.
