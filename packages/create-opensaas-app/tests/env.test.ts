import { describe, it, expect } from 'vitest'
import { generateEnvFiles } from '../src/lib/env.js'

describe('generateEnvFiles', () => {
  describe('sqlite (the default, zero-setup path)', () => {
    const { env, envExample } = generateEnvFiles({ provider: 'sqlite', projectName: 'my-app' })

    it('writes a runnable SQLite DATABASE_URL', () => {
      expect(env).toContain('DATABASE_URL="file:./dev.db"')
    })

    it('never hands a SQLite project a PostgreSQL connection string', () => {
      // The reproduced onboarding blocker: a Postgres URL in a SQLite project
      // makes `pnpm generate` fail with PrismaConfigEnvError. The active
      // (uncommented) DATABASE_URL must be SQLite.
      const activeLines = env.split('\n').filter((line) => !line.trimStart().startsWith('#'))
      expect(activeLines.join('\n')).not.toContain('postgresql://')
    })

    it('keeps the PostgreSQL hint commented out in the example', () => {
      expect(envExample).toContain('DATABASE_URL="file:./dev.db"')
      expect(envExample).toContain('# DATABASE_URL="postgresql://')
    })
  })

  describe('postgresql', () => {
    const { env, envExample } = generateEnvFiles({ provider: 'postgresql', projectName: 'my-app' })

    it('writes a PostgreSQL DATABASE_URL derived from the project name', () => {
      expect(env).toContain('DATABASE_URL="postgresql://')
      expect(env).toContain('localhost:5432/my_app?schema=public')
    })

    it('emits both the pooled DATABASE_URL and the direct DIRECT_DATABASE_URL', () => {
      // The pooled-app / direct-CLI split: the app's adapter uses DATABASE_URL,
      // the Prisma CLI uses DIRECT_DATABASE_URL (see the deployment guide).
      expect(env).toContain('DATABASE_URL="postgresql://')
      expect(env).toContain('DIRECT_DATABASE_URL="postgresql://')
      expect(envExample).toContain('DATABASE_URL="postgresql://')
      expect(envExample).toContain('DIRECT_DATABASE_URL="postgresql://')
    })

    it('never hands a Postgres project a SQLite file URL as the active DATABASE_URL', () => {
      const activeLines = env.split('\n').filter((line) => !line.trimStart().startsWith('#'))
      expect(activeLines.join('\n')).not.toContain('file:./dev.db')
    })

    it('offers SQLite as a commented alternative in the example', () => {
      expect(envExample).toContain('# DATABASE_URL="file:./dev.db"')
    })
  })

  it('always ends files with a trailing newline', () => {
    for (const provider of ['sqlite', 'postgresql'] as const) {
      const { env, envExample } = generateEnvFiles({ provider, projectName: 'app' })
      expect(env.endsWith('\n')).toBe(true)
      expect(envExample.endsWith('\n')).toBe(true)
    }
  })
})
