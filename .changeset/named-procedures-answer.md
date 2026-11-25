---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
'create-opensaas-app': patch
---

Define an application action once as a procedure and call it over HTTP.

`opensaas generate` now writes `.opensaas/procedures.ts`, a `procedure` builder typed to your own `Context`. Keep procedures in a registry module of your own (never in `opensaas.config.ts`) and serve it with `createProcedureHandler` from `@opensaas/stack-core/procedures`:

```typescript
// lib/procedures.ts
import * as z from 'zod'
import { procedure } from '@/.opensaas/procedures'

export const procedures = {
  createPost: procedure({
    description: 'Create a draft post authored by the caller',
    input: z.object({ title: z.string().min(1) }),
    output: z.object({ id: z.string(), title: z.string() }),
    access: ({ session }) => session !== null,
    expose: ['web'],
    run: async ({ input, context }) => {
      const post = await context.db.Post.create({ data: { title: input.title } })
      if (post === null) throw new Error('Post was not created')
      return post
    },
  }),
}

// app/api/procedures/[name]/route.ts
import { createProcedureHandler } from '@opensaas/stack-core/procedures'
import { getContext } from '@/.opensaas/context'
import { procedures } from '@/lib/procedures'
import { auth } from '@/lib/auth'

export const POST = createProcedureHandler({
  procedures,
  getContext,
  getSession: async (request) => {
    const result = await auth.api.getSession({ headers: request.headers })
    return result ? { userId: result.user.id } : null
  },
  allowedOrigins: ['http://localhost:3000'],
})
```

A caller POSTs JSON to `/api/procedures/<name>` and gets `{ success: true, data }` or `{ success: false, error: { code, message } }`. Description, input, output, access and a non-empty `expose` are required. `run` receives `db`, `session`, `storage` and `plugins` only. A cookie request must come from an allowed origin, any `Authorization` header is refused, unknown and unexposed names both answer 404, and undeclared output keys are removed. See ADR-0086.
