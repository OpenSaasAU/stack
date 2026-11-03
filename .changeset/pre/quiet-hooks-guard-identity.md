---
'@opensaas/stack-auth': minor
---

`User.email`, and `User.phoneNumber` / `User.username` when their plugins are registered, now ship update-denied on `context.db`, closing a session-confusion path via the owner-update rule. Reopen with `authPlugin({ fieldAccess })`.

Migration: an app updating these fields through `context.db` now gets a thrown field-access error. Change email and phone through better-auth's own flows, or reopen deliberately:

```ts
authPlugin({
  fieldAccess: { user: { email: { update: ({ session, item }) => session?.userId === item.id } } },
})
```
