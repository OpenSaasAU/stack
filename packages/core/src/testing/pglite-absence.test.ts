import { readFileSync, readdirSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test, vi } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { text } from '../fields/index.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: { Note: { fields: { body: text() } } },
}

describe('PGlite is an optional peer the testing subpath reaches only lazily', () => {
  test('no module on the subpath statically imports PGlite or the dev database', () => {
    const offenders: string[] = []
    for (const entry of readdirSync(HERE)) {
      if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue
      const source = readFileSync(path.join(HERE, entry), 'utf8')
      for (const match of source.matchAll(/^import[^\n]*from\s+'([^']+)'/gm)) {
        const specifier = match[1]
        if (specifier.startsWith('@electric-sql/') || specifier.endsWith('db/dev-database.js')) {
          offenders.push(`${entry} -> ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  test('a missing PGlite install is reported by name, with both remedies', async () => {
    const escape = process.env.DATABASE_URL
    delete process.env.DATABASE_URL
    vi.doMock('@electric-sql/pglite', () => {
      const error = new Error("Cannot find package '@electric-sql/pglite'")
      Object.assign(error, { code: 'ERR_MODULE_NOT_FOUND' })
      throw error
    })
    vi.resetModules()

    try {
      const { createTestDatabase, DevDatabaseUnavailableError } = await import('./context.js')
      await expect(createTestDatabase(config)).rejects.toThrow(DevDatabaseUnavailableError)
    } finally {
      vi.doUnmock('@electric-sql/pglite')
      vi.resetModules()
      if (escape !== undefined) process.env.DATABASE_URL = escape
    }
  })
})
