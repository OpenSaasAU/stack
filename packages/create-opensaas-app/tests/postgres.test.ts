import { describe, it, expect } from 'vitest'
import { toPostgresConfig, toPostgresPackageJson } from '../src/lib/postgres.js'

/**
 * A representative slice of the SQLite starter's `opensaas.config.ts` — the exact
 * `import` line and `db` block the transform must rewrite. Kept inline (rather
 * than reading the template, which only exists after a build) so the unit test
 * runs without a build step.
 */
const SQLITE_CONFIG = `import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

export default config({
  db: {
    provider: 'sqlite',
    prismaClientConstructor: (PrismaClient) => {
      const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || './dev.db' })
      return new PrismaClient({ adapter })
    },
  },

  lists: {},
})
`

describe('toPostgresConfig', () => {
  const result = toPostgresConfig(SQLITE_CONFIG)

  it('swaps the SQLite adapter import for the PrismaPg + pg imports', () => {
    expect(result).toContain("import { PrismaPg } from '@prisma/adapter-pg'")
    expect(result).toContain("import pg from 'pg'")
    expect(result).not.toContain('@prisma/adapter-better-sqlite3')
    expect(result).not.toContain('PrismaBetterSqlite3')
  })

  it('rewrites the db block to the documented PrismaPg form', () => {
    expect(result).toContain("provider: 'postgresql'")
    expect(result).toContain(
      'const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })',
    )
    expect(result).toContain('const adapter = new PrismaPg(pool)')
    expect(result).toContain('return new PrismaClient({ adapter })')
  })

  it('leaves no SQLite references anywhere in the result', () => {
    expect(result).not.toContain('sqlite')
    expect(result).not.toContain('better-sqlite3')
  })

  it('preserves the rest of the config (imports, lists)', () => {
    expect(result).toContain("import { config, list } from '@opensaas/stack-core'")
    expect(result).toContain("import { text } from '@opensaas/stack-core/fields'")
    expect(result).toContain('lists: {}')
  })

  it('throws when the expected SQLite shape is absent (template drift)', () => {
    expect(() => toPostgresConfig('export default config({ db: {} })')).toThrow()
  })
})

describe('toPostgresPackageJson', () => {
  const sqlitePkg = {
    name: 'my-app',
    dependencies: {
      '@opensaas/stack-core': '^0.1.0',
      '@opensaas/stack-ui': '^0.1.0',
      '@prisma/adapter-better-sqlite3': '^7.8.0',
      '@prisma/client': '^7.8.0',
      'better-sqlite3': '^12.6.2',
      next: '^16.1.6',
    },
    devDependencies: {
      '@opensaas/stack-cli': '^0.1.0',
      prisma: '^7.5.0',
      typescript: '^5.9.3',
    },
    scripts: {
      'db:push': 'prisma db push',
      migrate: 'prisma migrate dev',
      'migrate:deploy': 'prisma migrate deploy',
    },
  }

  const result = toPostgresPackageJson(sqlitePkg)

  it('removes the SQLite adapter and driver', () => {
    expect(result.dependencies?.['@prisma/adapter-better-sqlite3']).toBeUndefined()
    expect(result.dependencies?.['better-sqlite3']).toBeUndefined()
  })

  it('adds the Postgres adapter and pg driver at the monorepo versions', () => {
    expect(result.dependencies?.['@prisma/adapter-pg']).toBe('^7.8.0')
    expect(result.dependencies?.['pg']).toBe('^8.20.0')
    expect(result.devDependencies?.['@types/pg']).toBe('^8.18.0')
  })

  it('preserves the migrate / migrate:deploy scripts', () => {
    expect(result.scripts).toEqual(sqlitePkg.scripts)
  })

  it('preserves @opensaas deps, @prisma/client, and the name', () => {
    expect(result.name).toBe('my-app')
    expect(result.dependencies?.['@opensaas/stack-core']).toBe('^0.1.0')
    expect(result.dependencies?.['@prisma/client']).toBe('^7.8.0')
    expect(result.devDependencies?.['@opensaas/stack-cli']).toBe('^0.1.0')
  })

  it('leaves no SQLite dependency anywhere in the result', () => {
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('better-sqlite3')
  })

  it('does not mutate the input package.json', () => {
    expect(sqlitePkg.dependencies['better-sqlite3']).toBe('^12.6.2')
    expect(sqlitePkg.dependencies['@prisma/adapter-better-sqlite3']).toBe('^7.8.0')
  })
})
