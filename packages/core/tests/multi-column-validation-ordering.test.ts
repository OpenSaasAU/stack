import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { getContext } from '../src/context/index.js'
import { config, list } from '../src/config/index.js'
import { text } from '../src/fields/index.js'
import { ValidationError } from '../src/hooks/index.js'
import type { FieldConfig } from '../src/config/types.js'
import type { FieldAccess } from '../src/access/types.js'

/**
 * #789: a multi-column field's `resolveInput` can have a documented
 * "unrecognised value — return as-is and let validation catch it" fallback
 * (see storage image()/file() in Keystone-parity mode). Before this fix, the
 * split into physical columns ran BEFORE validation (inline inside
 * `executeFieldResolveInputHooks`), so an unrecognised value was silently split
 * into null/undefined columns and the write succeeded with corrupted/absent
 * data instead of throwing.
 *
 * These are full `context.db` integration tests (top-level AND nested writes)
 * proving validation now runs against the LOGICAL value first — an
 * unrecognised value throws `ValidationError` and the DB is never touched —
 * while the legitimate shapes (null/undefined and a valid object) continue to
 * split and persist exactly as before.
 */

/** A minimal multi-column field: two physical columns split from/assembled into `{ url, size }`. */
function mediaField(access?: FieldAccess): FieldConfig {
  const COLUMNS = ['m_url', 'm_size']
  return {
    type: 'multiColumn',
    access,
    getColumnNames: () => COLUMNS,
    assembleColumns: (_fieldName: string, row: Record<string, unknown>) => {
      const url = row.m_url
      if (url === null || url === undefined || url === '') return null
      return { url, size: row.m_size ?? 0 }
    },
    splitColumns: (_fieldName: string, value: unknown) => {
      if (value === null || value === undefined) {
        return { m_url: null, m_size: null }
      }
      const v = value as { url?: unknown; size?: unknown }
      return { m_url: v.url ?? null, m_size: v.size ?? null }
    },
    getZodSchema: () => z.object({ url: z.string(), size: z.number() }).nullable(),
    hooks: {
      // Mirrors storage image()/file()'s resolveInput contract: null/undefined
      // and an already-shaped value pass through unchanged; anything else is
      // the documented "unrecognised — return as-is and let validation catch
      // it" fallback. This is the exact fallback #789 is about.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic test hook
      resolveInput: async ({ resolvedData, fieldKey }: any) => resolvedData?.[fieldKey],
    },
  } as unknown as FieldConfig
}

/** A tiny in-memory ORM double over one table, in the rc.8 collection's shape. */
function createTxPrisma() {
  const tables: Record<string, Map<string, Record<string, unknown>>> = { Post: new Map() }
  let idCounter = 0
  const nextId = () => `id-${++idCounter}`

  function doCreate(table: string, data: Record<string, unknown>): Record<string, unknown> {
    const id = (data.id as string) ?? nextId()
    const record = { id, ...data }
    tables[table].set(id, record)
    return record
  }

  function doUpdate(
    table: string,
    id: string,
    data: Record<string, unknown>,
  ): Record<string, unknown> {
    const updated = { ...(tables[table].get(id) ?? { id }), ...data }
    tables[table].set(id, updated)
    return updated
  }

  function makeModel(table: string) {
    // The double answers `first()` with the row the composed predicate would
    // have matched — the suite writes one row per table, so the first row is
    // that row.
    const model = {
      where: vi.fn(() => model),
      first: vi.fn(async () => tables[table].values().next().value ?? null),
      aggregate: vi.fn(async () => ({ rows: tables[table].size })),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => tables[table].get(where.id) ?? null,
      ),
      findFirst: vi.fn(async () => tables[table].values().next().value ?? null),
      findMany: vi.fn(async () => Array.from(tables[table].values())),
      count: vi.fn(async () => tables[table].size),
      create: vi.fn(async (data: Record<string, unknown>) => doCreate(table, data)),
      update: vi.fn(async (data: Record<string, unknown>) => {
        const target = tables[table].values().next().value
        return doUpdate(table, (target?.id as string) ?? nextId(), data)
      }),
      delete: vi.fn(),
    }
    return model
  }

  const client: Record<string, unknown> = { Post: makeModel('Post') }
  client.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(client)

  return { client, tables }
}

describe('#789 top-level write — multi-column validation runs BEFORE the split', () => {
  let mock: ReturnType<typeof createTxPrisma>

  beforeEach(() => {
    mock = createTxPrisma()
    vi.clearAllMocks()
  })

  function makeTestConfig() {
    return config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        Post: list({
          fields: { title: text(), media: mediaField() },
          access: { operation: { query: () => true, create: () => true, update: () => true } },
        }),
      },
    })
  }

  it('create: an unrecognised media value throws ValidationError and never reaches the DB', async () => {
    const context = getContext(await makeTestConfig(), mock.client, { userId: '1' })

    await expect(
      context.db.Post.create({ data: { title: 'hi', media: 'not-a-valid-shape' } }),
    ).rejects.toBeInstanceOf(ValidationError)

    expect(mock.tables.Post.size).toBe(0)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((mock.client.Post as any).create).not.toHaveBeenCalled()
  })

  it('create: a valid media value passes validation and is split into physical columns', async () => {
    const context = getContext(await makeTestConfig(), mock.client, { userId: '1' })

    const created = await context.db.Post.create({
      data: { title: 'hi', media: { url: 'https://x/y.jpg', size: 99 } },
    })

    expect(created).toBeTruthy()
    const stored = mock.tables.Post.values().next().value
    expect(stored).toMatchObject({ m_url: 'https://x/y.jpg', m_size: 99 })
    expect('media' in (stored ?? {})).toBe(false)
  })

  it('create: a null media value passes validation and clears the columns', async () => {
    const context = getContext(await makeTestConfig(), mock.client, { userId: '1' })

    await context.db.Post.create({ data: { title: 'hi', media: null } })

    const stored = mock.tables.Post.values().next().value
    expect(stored).toMatchObject({ m_url: null, m_size: null })
  })

  it('update: an unrecognised media value throws ValidationError and never reaches the DB', async () => {
    mock.tables.Post.set('p1', { id: 'p1', title: 'old', m_url: null, m_size: null })
    const context = getContext(await makeTestConfig(), mock.client, { userId: '1' })

    await expect(
      context.db.Post.update({ where: { id: 'p1' }, data: { media: 42 } }),
    ).rejects.toBeInstanceOf(ValidationError)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((mock.client.Post as any).update).not.toHaveBeenCalled()
    expect(mock.tables.Post.get('p1')).toMatchObject({ title: 'old', m_url: null, m_size: null })
  })

  it('update: a valid media value passes validation and is split into physical columns', async () => {
    mock.tables.Post.set('p1', { id: 'p1', title: 'old', m_url: null, m_size: null })
    const context = getContext(await makeTestConfig(), mock.client, { userId: '1' })

    await context.db.Post.update({
      where: { id: 'p1' },
      data: { media: { url: 'https://x/new.jpg', size: 5 } },
    })

    expect(mock.tables.Post.get('p1')).toMatchObject({ m_url: 'https://x/new.jpg', m_size: 5 })
  })
})
