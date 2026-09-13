import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { CONNECTION_VARIABLES } from '../db/url.js'
import {
  ESCAPE_VARIABLES,
  readDatabaseEscape,
  requireUsableDatabaseEscape,
  UnusableDatabaseEscapeError,
} from './escape.js'

describe('readDatabaseEscape', () => {
  let saved: Record<string, string | undefined>

  beforeEach(() => {
    saved = Object.fromEntries(CONNECTION_VARIABLES.map((name) => [name, process.env[name]]))
    for (const name of CONNECTION_VARIABLES) delete process.env[name]
  })

  afterEach(() => {
    for (const name of CONNECTION_VARIABLES) {
      const value = saved[name]
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  test('agrees with resolveDatabaseUrl() on which variables it reads, in the same order', () => {
    expect(ESCAPE_VARIABLES).toEqual(CONNECTION_VARIABLES)
    expect(ESCAPE_VARIABLES[0]).toBe('DIRECT_DATABASE_URL')
  })

  test('is absent when neither variable is set', () => {
    expect(readDatabaseEscape()).toEqual({ kind: 'absent' })
  })

  test('is postgres from DATABASE_URL alone', () => {
    process.env.DATABASE_URL = 'postgres://someone@example.test:5432/app'
    expect(readDatabaseEscape()).toEqual({
      kind: 'postgres',
      url: 'postgres://someone@example.test:5432/app',
    })
  })

  test('is postgres from DIRECT_DATABASE_URL alone, rather than falling back to absent (#1210)', () => {
    process.env.DIRECT_DATABASE_URL = 'postgres://direct@example.test:5432/app'
    expect(readDatabaseEscape()).toEqual({
      kind: 'postgres',
      url: 'postgres://direct@example.test:5432/app',
    })
  })

  test('prefers DIRECT_DATABASE_URL over DATABASE_URL, matching resolveDatabaseUrl()', () => {
    process.env.DATABASE_URL = 'postgres://pooler@example.test:6543/app'
    process.env.DIRECT_DATABASE_URL = 'postgres://direct@example.test:5432/app'
    expect(readDatabaseEscape()).toEqual({
      kind: 'postgres',
      url: 'postgres://direct@example.test:5432/app',
    })
  })

  test('a set-but-unusable DATABASE_URL is refused by name, not dialled', () => {
    process.env.DATABASE_URL = 'file:./dev.db'
    expect(readDatabaseEscape()).toEqual({
      kind: 'unusable',
      variable: 'DATABASE_URL',
      url: 'file:./dev.db',
      fault: 'names the `file:` scheme, not Postgres',
    })
  })

  test('a set-but-unusable DIRECT_DATABASE_URL is refused by name too', () => {
    process.env.DIRECT_DATABASE_URL = 'file:./dev.db'
    expect(readDatabaseEscape()).toEqual({
      kind: 'unusable',
      variable: 'DIRECT_DATABASE_URL',
      url: 'file:./dev.db',
      fault: 'names the `file:` scheme, not Postgres',
    })
  })

  test('an unusable DIRECT_DATABASE_URL wins over a usable DATABASE_URL, matching resolveDatabaseUrl() order', () => {
    process.env.DATABASE_URL = 'postgres://pooler@example.test:6543/app'
    process.env.DIRECT_DATABASE_URL = 'not a url at all'
    expect(readDatabaseEscape()).toEqual({
      kind: 'unusable',
      variable: 'DIRECT_DATABASE_URL',
      url: 'not a url at all',
      fault: 'is not a URL',
    })
  })

  test('requireUsableDatabaseEscape returns undefined when absent', () => {
    expect(requireUsableDatabaseEscape()).toBeUndefined()
  })

  test('requireUsableDatabaseEscape returns the url when usable', () => {
    process.env.DIRECT_DATABASE_URL = 'postgres://direct@example.test:5432/app'
    expect(requireUsableDatabaseEscape()).toBe('postgres://direct@example.test:5432/app')
  })

  test('requireUsableDatabaseEscape throws naming the variable, the value and both remedies', () => {
    process.env.DIRECT_DATABASE_URL = 'file:./dev.db'
    try {
      requireUsableDatabaseEscape()
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(UnusableDatabaseEscapeError)
      if (!(error instanceof UnusableDatabaseEscapeError)) return
      expect(error.variable).toBe('DIRECT_DATABASE_URL')
      expect(error.url).toBe('file:./dev.db')
      expect(error.message).toContain('DIRECT_DATABASE_URL')
      expect(error.message).toContain('file:./dev.db')
      expect(error.message).toMatch(/postgres:\/\//)
      expect(error.message).toMatch(/unset it/)
    }
  })
})
