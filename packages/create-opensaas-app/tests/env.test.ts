import { describe, it, expect } from 'vitest'
import { generateEnvFiles } from '../src/lib/env.js'

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
