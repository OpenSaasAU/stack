import 'dotenv/config'
import { defineConfig } from 'prisma/config'

// Read an environment variable, returning undefined when unset so the
// `??` fallback below can take effect. (The `env` helper from
// 'prisma/config' throws on missing variables, which would break the
// fallback.)
const env = (name: string): string | undefined => process.env[name]

export default defineConfig({
  schema: 'prisma',
  datasource: {
    url: env('DIRECT_DATABASE_URL') ?? env('DATABASE_URL'),
  },
})
