import { describe, it, expect } from 'vitest'
import { generateAuthEnv, generateEnvFiles } from '../src/lib/env.js'

describe('generateEnvFiles', () => {
  const { env, envExample } = generateEnvFiles({ projectName: 'my-app' })

  it('sets no DATABASE_URL, so the first `pnpm dev` starts the Dev database', () => {
    const active = env
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n')
    expect(active).not.toContain('DATABASE_URL')
  })

  it('offers the Database escape as a commented Postgres URL from the project name', () => {
    expect(env).toContain('# DATABASE_URL="postgresql://')
    expect(env).toContain('localhost:5432/my_app')
  })

  it('commits the same shape as the example, so the two cannot drift', () => {
    expect(envExample).toBe(env)
  })

  it('always ends files with a trailing newline', () => {
    expect(env.endsWith('\n')).toBe(true)
    expect(envExample.endsWith('\n')).toBe(true)
  })
})

describe('generateAuthEnv', () => {
  const example = [
    'BETTER_AUTH_SECRET=your_secret_key_here  # Generate with: openssl rand -base64 32',
    'BETTER_AUTH_URL=http://localhost:3000',
    '',
    '# Rate Limiting',
    '# Set to true to disable rate limiting (useful for local development)',
    'DISABLE_RATE_LIMITING=true',
    '',
  ].join('\n')
  const out = generateAuthEnv(example, 'abc123')

  it('replaces the placeholder secret', () => {
    expect(out).toContain('BETTER_AUTH_SECRET=abc123\n')
    expect(out).not.toContain('your_secret_key_here')
  })

  it('leaves DISABLE_RATE_LIMITING inactive, even with CRLF endings', () => {
    for (const text of [out, generateAuthEnv(example.replace(/\n/g, '\r\n'), 'abc123')]) {
      expect(text).not.toMatch(/^DISABLE_RATE_LIMITING=/m)
    }
  })

  it('adds a secret when the example has none', () => {
    expect(generateAuthEnv('FOO=bar\n', 'abc123')).toContain('BETTER_AUTH_SECRET=abc123')
  })
})
