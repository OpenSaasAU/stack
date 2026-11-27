---
'create-opensaas-app': minor
---

The `with-auth` template now writes its post mutations as procedures and ships lint guardrails.

A scaffolded auth app gets:

- `lib/procedures.ts`: `createPost`, `updatePost`, `publishPost` and `deletePost`, each with Zod input and output, declared failures, `access: ({ session }) => session?.actor?.kind === 'human'` and `expose: ['web']`
- `lib/server.ts`: the one module that imports `getContext`, exporting `callProcedure`, `getServerContext()` and the HTTP host served at `app/api/procedures/[name]/route.ts`
- a `/posts` page that reads through `getServerContext()`, creates through a server action that only calls a procedure and redirects, and updates, publishes and deletes through the typed browser client
- `eslint.config.js`, run by `pnpm lint`, which refuses any other import of the context factory and allows `'use server'` only in `lib/actions/*.ts` and the admin page

```typescript
// lib/actions/posts.ts
'use server'

import { redirect } from 'next/navigation'
import { callProcedure } from '@/lib/server'

export async function publishPostAction(id: string) {
  const result = await callProcedure('publishPost', { id })
  if (!result.success) return { error: result.error.message }
  redirect('/posts')
}
```

The lint rules are a guardrail, not a security boundary: list access control is what protects the data. The unused `lib/actions/users.ts` is removed.
