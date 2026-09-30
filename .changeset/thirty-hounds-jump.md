---
'@opensaas/stack-auth': minor
---

Derived Auth list fields that better-auth marks `input: false` now ship field-level write-denied on `context.db`, independent of whatever operation-level access the application grants — the write-side twin of the existing credential read-deny (ADR-0036). This closes a privilege-escalation hole (issue #1618): a whole-row owner-update rule (`update: ({ session, item }) => session?.userId === item.id`) no longer lets a signed-in user set `User.emailVerified` (denied unconditionally), or — once the `admin()` plugin is registered — `User.role`, `User.banned`, `User.banReason`, `User.banExpires` and `Session.impersonatedBy`. A field that is both a credential and `input: false` gets both denies, composed rather than one overwriting the other. `sudo()` and better-auth's own flows (sign-up, `setRole`, `banUser`, email verification) are unaffected, since they bypass field-level access or write through the Auth adapter.

**Reopen a seeded deny with the new `authPlugin({ fieldAccess })` option**, keyed by better-auth model key then field key like `credentialFields`, each value overriding one or more of a field's `read`/`create`/`update` rules:

```typescript
import { admin } from 'better-auth/plugins'

authPlugin({
  betterAuthPlugins: [admin()],
  access: {
    user: {
      operation: {
        update: ({ session, item }) => session?.userId === item.id || session?.role === 'admin',
      },
    },
  },
  fieldAccess: {
    user: {
      role: { update: ({ session }) => session?.role === 'admin' },
    },
  },
})
```

An entry cannot reopen a credential's `read` deny (throws at config time, naming the model and field) — ADR-0036's read-deny stays permanently closed. Validation otherwise matches `credentialFields`: a field missing from a model you actually derive throws; a model you haven't registered a plugin for is a silent no-op. See ADR-0073.
