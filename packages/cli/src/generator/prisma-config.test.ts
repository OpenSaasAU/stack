import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  generatePrismaConfig,
  extractExtraDatasourceLines,
  writePrismaConfig,
} from './prisma-config.js'
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

    it('re-emits host-added datasource keys after the managed url key', () => {
      const output = generatePrismaConfig(config, undefined, [
        "shadowDatabaseUrl: env('SHADOW_DATABASE_URL'),",
      ])
      expect(output).toContain(
        "url: env('DIRECT_DATABASE_URL') ?? env('DATABASE_URL'),\n    shadowDatabaseUrl: env('SHADOW_DATABASE_URL'),",
      )
    })
  })

  describe('extractExtraDatasourceLines', () => {
    it('returns host-added keys, excluding the managed url key', () => {
      const existing = `
export default defineConfig({
  schema: 'prisma',
  datasource: {
    url: env('DIRECT_DATABASE_URL') ?? env('DATABASE_URL'),
    shadowDatabaseUrl: env('SHADOW_DATABASE_URL'),
  },
})
`
      expect(extractExtraDatasourceLines(existing)).toEqual([
        "shadowDatabaseUrl: env('SHADOW_DATABASE_URL'),",
      ])
    })

    it('returns an empty array when there is no extra key', () => {
      const existing = `
export default defineConfig({
  datasource: {
    url: env('DIRECT_DATABASE_URL') ?? env('DATABASE_URL'),
  },
})
`
      expect(extractExtraDatasourceLines(existing)).toEqual([])
    })

    it('returns an empty array when there is no datasource block', () => {
      expect(extractExtraDatasourceLines('export default defineConfig({})\n')).toEqual([])
    })
  })

  describe('writePrismaConfig', () => {
    let tempDir: string

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prisma-config-test-'))
    })

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true })
    })

    it('preserves a host-added datasource key across a re-generate', () => {
      const outputPath = path.join(tempDir, 'prisma.config.ts')
      fs.writeFileSync(
        outputPath,
        `import 'dotenv/config'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma',
  datasource: {
    url: 'file:./stale.db',
    shadowDatabaseUrl: env('SHADOW_DATABASE_URL'),
  },
})
`,
        'utf-8',
      )

      writePrismaConfig(config, outputPath)

      const result = fs.readFileSync(outputPath, 'utf-8')
      expect(result).toContain("shadowDatabaseUrl: env('SHADOW_DATABASE_URL'),")
      // The managed key is regenerated, not left as the stale on-disk value.
      expect(result).toContain("url: env('DIRECT_DATABASE_URL') ?? env('DATABASE_URL'),")
      expect(result).not.toContain("'file:./stale.db'")
    })

    it('produces byte-identical output to today when there are no extra datasource keys', () => {
      const outputPath = path.join(tempDir, 'prisma.config.ts')
      writePrismaConfig(config, outputPath)
      const first = fs.readFileSync(outputPath, 'utf-8')

      writePrismaConfig(config, outputPath)
      const second = fs.readFileSync(outputPath, 'utf-8')

      expect(second).toBe(first)
      expect(second).toBe(generatePrismaConfig(config))
    })

    it('writes the file when none exists yet', () => {
      const outputPath = path.join(tempDir, 'nested', 'prisma.config.ts')
      writePrismaConfig(config, outputPath)

      expect(fs.existsSync(outputPath)).toBe(true)
      expect(fs.readFileSync(outputPath, 'utf-8')).toBe(generatePrismaConfig(config))
    })
  })
})
