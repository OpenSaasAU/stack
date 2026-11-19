---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': patch
'create-opensaas-app': patch
---

Add `@opensaas/stack-core/db-client`, the server-only subpath for `resolveRuntimeConnection`, and deprecate `@opensaas/stack-core/client`

`/client` sat beside `/client-safe` and read as browser-safe, but it reaches `pg`. `opensaas generate` now emits the new subpath in `.opensaas/context.ts`. `/client` still resolves to the same bindings, marked `@deprecated`, and is removed at the next major.

Migration — regenerate (`pnpm generate`) and update any hand-written import:

```typescript
// Before
import { resolveRuntimeConnection } from '@opensaas/stack-core/client'

// After
import { resolveRuntimeConnection } from '@opensaas/stack-core/db-client'
```
