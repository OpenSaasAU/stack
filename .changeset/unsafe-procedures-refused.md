---
'@opensaas/stack-core': minor
'create-opensaas-app': patch
---

Refuse unsafe procedure definitions when the host is created.

`createProcedureHandler` now throws `ProcedureHostError`, naming the procedure, the offending part and the fix, for:

- an `input` or `output` schema that does not convert to JSON Schema on its own side (dates, bigints, output transforms, `z.undefined()`, `z.void()`)
- the open-ended shapes Zod provides, at any depth: `z.any()`, `z.unknown()`, `z.json()`, a loose object, a `z.looseRecord` or a `z.record` of `any`/`unknown`; and an output object with a `.catchall()`. A hand-written schema that accepts as much is not recognised
- `z.file()`, which a JSON body cannot carry
- a `config` option that is not a resolved config, such as an un-awaited promise
- a name matching the reserved `list_<list>_<operation>` pattern of generated MCP tools
- a name a list custom tool or a plugin-registered MCP tool already carries, when the host is given the config

```typescript
// app/api/procedures/[name]/route.ts
import { createProcedureHandler } from '@opensaas/stack-core/procedures'
import config from '@/opensaas.config'
import { getContext } from '@/.opensaas/context'
import { procedures } from '@/lib/procedures'
import { getSession } from '@/lib/auth'

export const POST = createProcedureHandler({
  procedures,
  config: await config, // optional: adds the custom and plugin tool name check
  getContext,
  getSession: (request) => getSession(request.headers),
  allowedOrigins: ['http://localhost:3000'],
})
```

A procedure that takes no input uses `z.object({}).optional()`, one that returns nothing uses `z.null()`, and a date travels as `z.iso.datetime()`. The checks are also exported for other hosts: `assertProcedureRegistry`, `assertProcedureSchemas` and `assertProcedureNamesAvailable`.
