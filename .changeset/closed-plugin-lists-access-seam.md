---
'@opensaas/stack-auth': major
---

BREAKING: Auth-injected lists (User/Session/Account/Verification) now ship **closed** — no operation-level access — instead of shipping permissive defaults (`query: () => true`, self-only update/delete). Per ADR-0013, access control belongs to the application. With no access configured, `context.db` reads/writes against these lists return `null`/`[]` and they no longer appear in the admin UI. better-auth's own sign-in/sign-up/session flows are unaffected — they write through the raw Prisma client, bypassing access control entirely.

Grant access with the new `authPlugin({ access: { ... } })` passthrough, keyed by better-auth model name (`user`/`session`/`account`/`verification` — not the derived list key, so it stays correct if you rename a model via `modelName`). Each entry is a full list access config (operation and field-level):

```typescript
authPlugin({
  access: {
    user: {
      operation: {
        query: ({ session }) => !!session,
        update: ({ session, item }) => session?.userId === item.id,
      },
    },
    session: {
      operation: {
        query: ({ session }) => (session ? { user: { id: { equals: session.userId } } } : false),
      },
    },
  },
})
```

For the User list specifically, `extendUserList.access` (unchanged) still works and takes precedence over `access.user` if both are set.

The runtime `getUser`/`getCurrentUser` helpers now resolve through `context.sudo()`, so "who is this session" no longer depends on the application's User list access policy.

Migration: if you relied on the old permissive defaults, add the equivalent rules under `authPlugin({ access: { ... } })` for any Auth list your app reads or writes through `context.db` or the admin UI.
