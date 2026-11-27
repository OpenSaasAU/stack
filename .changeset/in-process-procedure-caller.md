---
'@opensaas/stack-core': minor
---

Add `createServerCaller`, the in-process host for procedures, and a session-resolved context for server components

Server actions call procedures without passing an identity, and server components read through a context whose session comes from the request. Neither takes a session: `getSession` takes no argument and runs on every call, and the session it resolves carries the same human actor the HTTP host sets.

```typescript
// lib/server.ts
import { createServerCaller } from '@opensaas/stack-core/procedures'
import { config, getContext } from '@/.opensaas/context'
import { procedures } from '@/lib/procedures' // declared with `satisfies ProcedureRegistry<Context>`
import { getSession } from '@/lib/auth'

const server = createServerCaller({ procedures, config: await config, getContext, getSession })

export const callProcedure = server.call
export const getServerContext = server.context
```

```typescript
// app/posts/actions.ts
'use server'

import { redirect } from 'next/navigation'
import { callProcedure } from '@/lib/server'

export async function createPost(formData: FormData) {
  const result = await callProcedure('createPost', { title: String(formData.get('title')) })
  if (!result.success) return result.error
  redirect(`/posts/${result.data.id}`)
}
```

`call` runs the HTTP host's pipeline (exposure, access, input and output parsing, declared failures, redaction) and resolves to the same result, typed per procedure. Only procedures exposed to `'web'` are callable; any other name is `INTERNAL` and reported. A `redirect()` or `notFound()` thrown by the session resolver, the access rule or `run` reaches the framework in-process, and is `INTERNAL` over HTTP.
