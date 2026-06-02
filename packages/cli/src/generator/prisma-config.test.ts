import { describe, it, expect } from 'vitest'
import { generatePrismaConfig } from './prisma-config.js'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'

const config: OpenSaasConfig = {
  db: {
    provider: 'sqlite',
  },
  lists: {
    User: {
      fields: {
        name: text(),
      },
    },
  },
}

describe('Prisma Config Generator', () => {
  describe('generatePrismaConfig', () => {
    it('emits a datasource that prefers DIRECT_DATABASE_URL and falls back to DATABASE_URL', () => {
      const output = generatePrismaConfig(config)
      expect(output).toContain("env('DIRECT_DATABASE_URL') ?? env('DATABASE_URL')")
    })

    it('emits a local env helper that returns undefined for missing vars (so the ?? fallback works)', () => {
      const output = generatePrismaConfig(config)
      // The upstream `env` from 'prisma/config' throws on missing variables,
      // which would break the `??` fallback — so we must not import it.
      expect(output).not.toContain("import { defineConfig, env } from 'prisma/config'")
      expect(output).toContain("import { defineConfig } from 'prisma/config'")
      expect(output).toContain(
        'const env = (name: string): string | undefined => process.env[name]',
      )
    })

    it('keeps dotenv loading and defineConfig wiring', () => {
      const output = generatePrismaConfig(config)
      expect(output).toContain("import 'dotenv/config'")
      expect(output).toContain('export default defineConfig({')
      expect(output).toContain("schema: 'prisma',")
    })

    it('matches the full snapshot', () => {
      expect(generatePrismaConfig(config)).toMatchSnapshot()
    })
  })
})
