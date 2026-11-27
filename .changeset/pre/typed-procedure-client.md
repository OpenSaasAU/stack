---
'@opensaas/stack-core': minor
---

Call procedures from the browser with a typed client.

`createProcedureClient` from the new `@opensaas/stack-core/procedures/client` entry calls the HTTP host with the name, the input and the result inferred from your registry. Give it the registry's **type**: the import is erased, so the entry is safe in a `'use client'` module and no server code reaches the bundle.

Declare the registry with `satisfies`, which keeps each procedure's own type:

```typescript
// lib/procedures.ts
import type { ProcedureRegistry } from '@opensaas/stack-core/procedures'
import type { Context } from '@/.opensaas/types'

export const procedures = { createPost, bookSlot } satisfies ProcedureRegistry<Context>
```

```typescript
// components/book.ts
'use client'

import { createProcedureClient } from '@opensaas/stack-core/procedures/client'
import type { procedures } from '@/lib/procedures'

const call = createProcedureClient<typeof procedures>()

export async function book(slotId: string): Promise<string> {
  const result = await call('bookSlot', { slotId })
  if (result.success) return `Booked ${result.data.bookingId}`
  switch (result.error.code) {
    case 'SLOT_FULL':
      return 'That slot is full'
    case 'transport':
      return 'Could not reach the server'
    default:
      return result.error.message
  }
}
```

An unknown procedure name or a renamed input field is a compile error (and a registry type that admits any name, an annotated one or a missing type argument, leaves no name callable), and `error.code` is the union of the reserved codes, the codes that procedure declares and `'transport'`. A call never throws: a request the client did not send (an input JSON cannot carry, or a name no host serves), a request that was never answered, a refusal from the host before the pipeline ran (404, 405, 413, 415) and a response that is not a procedure result all resolve to `{ success: false, error: { code: 'transport', reason, status?, message } }` with `reason` `'unsent'`, `'network'`, `'refused'` or `'malformed'`. The client never retries, `RETRY` included, sends no `Authorization` header, and sends the input as given: leaving it out sends an empty body, which is allowed only where the input schema accepts `undefined`. Options are `baseUrl` (default `/api/procedures`), `credentials` (default `'same-origin'`) and `fetch`. A host on the page's own origin needs nothing more. A host on another origin also needs the application to answer the CORS preflight and add the CORS headers itself, since the host sends none. See ADR-0086.
