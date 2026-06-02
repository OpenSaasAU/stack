---
'@opensaas/stack-cli': minor
---

Generate a `prisma.config.ts` datasource that supports the production `prisma migrate` workflow.

The generated datasource URL now prefers `DIRECT_DATABASE_URL` and falls back to `DATABASE_URL`, so migrations can use a direct (non-pooled) connection on serverless Postgres (e.g. Neon) while the running app connects through the pooled `DATABASE_URL`. Local SQLite is unaffected: with `DIRECT_DATABASE_URL` unset, the expression resolves to `DATABASE_URL`.

```typescript
// generated prisma.config.ts
import 'dotenv/config'
import { defineConfig } from 'prisma/config'

// Returns undefined for missing vars so the `??` fallback can take effect.
const env = (name: string): string | undefined => process.env[name]

export default defineConfig({
  schema: 'prisma',
  datasource: {
    url: env('DIRECT_DATABASE_URL') ?? env('DATABASE_URL'),
  },
})
```

To use a direct connection for migrations on serverless Postgres, set `DIRECT_DATABASE_URL` in your environment; `prisma migrate dev` / `prisma migrate deploy` will use it. See ADR-0003.
