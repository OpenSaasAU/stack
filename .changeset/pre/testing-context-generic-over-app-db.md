---
'@opensaas/stack-core': minor
---

`createTestContext` and `createTestDatabase` (`@opensaas/stack-core/testing`) are now generic over the context they hand back. Name your app's own generated `Context` to get the same typed rows, `where`, `select` and `include` a generated `getContext()` gives, over the harness's own isolated database, instead of the engine's untyped `StackContext<AccessControlledDB>`:

```typescript
import { createTestContext } from '@opensaas/stack-core/testing'
import type { Context } from '../.opensaas/types.js'

const harness = await createTestContext<Context>(config, { userId: 'user-1' })
const post = await harness.context.db.Post.where({ id: { equals: postId } }).first()
post?.title // typed, not `unknown`
```

Omitting the type parameter keeps the previous, untyped behavior — no existing call site needs to change.
