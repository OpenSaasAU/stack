---
'@opensaas/stack-core': minor
---

`getContext`, `withSession` and `createTestContext` now refuse a session that holds `undefined` for one of its own keys

`session ?? null` only treats `null`/`undefined` themselves as anonymous — a non-null object is signed in even when every property on it is `undefined`. `getContext({ userId })` from an unguarded `userId?: string` builds exactly that object, and an access rule written as `session === null ? ... : true` took its signed-in branch for an anonymous caller (#1397, the defect behind #1387).

All three entry points share one low-level `getContext`, so the one guard there closes this for each of them:

```typescript
import { getContext, InvalidSessionError } from '@opensaas/stack-core'

try {
  await getContext({ userId: undefined })
} catch (error) {
  error instanceof InvalidSessionError // true
}
```

Build the session from an optional identifier by omitting the key rather than setting it to `undefined`:

```typescript
const context = userId ? await getContext({ userId }) : await getContext()
```

The MCP runtime's own session-to-context translation is hardened the same way: a custom MCP session field resolved to `undefined` is dropped before it reaches `getContext`, rather than tripping the new refusal for a session that is genuinely signed in (`userId` is required and untouched, so the refusal still catches it if that one is ever `undefined`).

Note this doesn't close every way an object can reach `getContext` looking signed in — wrapping an already-resolved session under a key, `getContext({ session })`, still reads as signed in when that wrapped value is `null` rather than `undefined`, because `null` is a value, not a missing one. Don't wrap the session at all: branch on it before calling `getContext`, as above.
