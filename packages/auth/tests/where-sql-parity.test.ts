import { describe, expect, test } from 'vitest'
import type { CleanedWhere } from 'better-auth/adapters'
import { sqlWhere } from '../src/adapter/where.js'
import type { AuthSqlFieldProxy, AuthSqlFunctions } from '../src/adapter/surface.js'

interface Rendered {
  readonly sql: string
}

const render = (value: unknown): string =>
  typeof value === 'object' && value !== null && 'sql' in value
    ? String(value.sql)
    : JSON.stringify(value)

const joined = (op: string, exprs: readonly unknown[]) =>
  ({ sql: `(${exprs.map(render).join(` ${op} `)})` }) as Rendered

const fns = {
  eq: (a: unknown, b: unknown) => ({ sql: `${render(a)} = ${render(b)}` }),
  ne: (a: unknown, b: unknown) => ({ sql: `${render(a)} <> ${render(b)}` }),
  gt: () => ({ sql: 'gt' }),
  gte: () => ({ sql: 'gte' }),
  lt: () => ({ sql: 'lt' }),
  lte: () => ({ sql: 'lte' }),
  and: (...exprs: unknown[]) => joined('AND', exprs),
  or: (...exprs: unknown[]) => joined('OR', exprs),
  in: (a: unknown, b: unknown) => ({ sql: `${render(a)} IN ${render(b)}` }),
  notIn: (a: unknown, b: unknown) => ({ sql: `${render(a)} NOT IN ${render(b)}` }),
  ilike: (a: unknown, b: unknown) => ({ sql: `${render(a)} ILIKE ${render(b)}` }),
  raw: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    returns: () => ({
      sql: strings.reduce(
        (out, part, i) => out + part + (i < values.length ? render(values[i]) : ''),
        '',
      ),
    }),
  }),
}

const fields = { email: { sql: 'email' } }
const resolve = () => ({ key: 'email', isBigInt: false })

function lower(clause: Partial<CleanedWhere>): string {
  const expr = sqlWhere(
    fields as unknown as AuthSqlFieldProxy,
    fns as unknown as AuthSqlFunctions,
    [{ field: 'email', operator: 'eq', connector: 'AND', value: null, ...clause } as CleanedWhere],
    resolve,
  )
  return render(expr)
}

describe('typed-SQL where parity with the ORM lowering', () => {
  test('eq null is IS NULL', () => {
    expect(lower({ operator: 'eq', value: null })).toBe('email IS NULL')
  })

  test('ne null is IS NOT NULL', () => {
    expect(lower({ operator: 'ne', value: null })).toBe('email IS NOT NULL')
  })

  test('insensitive in is a disjunction of ILIKE', () => {
    expect(lower({ operator: 'in', value: ['A', 'b'], mode: 'insensitive' })).toBe(
      '(email ILIKE "A" OR email ILIKE "b")',
    )
  })

  test('insensitive not_in negates every ILIKE', () => {
    const sql = lower({ operator: 'not_in', value: ['A', 'b'], mode: 'insensitive' })
    expect(sql).toContain('email NOT ILIKE')
    expect(sql).toContain(' AND ')
  })

  test('sensitive in stays a plain IN', () => {
    expect(lower({ operator: 'in', value: ['a'] })).toBe('email IN ["a"]')
  })
})
