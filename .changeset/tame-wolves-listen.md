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
