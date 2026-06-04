import { describe, it, expect } from 'vitest'
import { filterReadableFields } from './field-visibility.js'
import { executeFieldResolveInputHooks } from '../hooks/index.js'
import type { FieldConfig } from '../config/types.js'
import type { AccessContext, FieldAccess } from './types.js'

/**
 * Generic core wiring for multi-column fields (the contract storage
 * image()/file() use in Keystone-parity mode — see ADR-0006). These tests are
 * field-agnostic: they assert that ANY field implementing
 * getColumnNames/assembleColumns/splitColumns is assembled on read (raw columns
 * stripped) and split on write.
 */

// A minimal multi-column field: two physical columns `m_url` and `m_size`
// assembled into `{ url, size }` and split back. Optionally carries field-level
// access so we can lock the write-access gate around the split.
function multiColumnField(access?: FieldAccess): FieldConfig {
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
    // Field's own resolveInput is identity here (the value is authoritative).
    hooks: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic test hook
      resolveInput: async ({ resolvedData, fieldKey }: any) => resolvedData?.[fieldKey],
    },
  } as unknown as FieldConfig
}

function makeContext(overrides: { isSudo?: boolean } = {}): AccessContext {
  return {
    session: null,
    _isSudo: overrides.isSudo ?? false,
    _resolveOutputCounter: { depth: 0 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal context for unit test
  } as any
}

describe('multi-column read assembly (filterReadableFields)', () => {
  const fields = { media: multiColumnField() }

  it('assembles the per-part columns into the logical field and strips the raw columns', async () => {
    const row = { id: 'a', m_url: 'https://x/y.jpg', m_size: 99, title: 'hi' }
    const result = await filterReadableFields(
      row,
      // title is a plain field
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inline field configs
      { ...fields, title: { type: 'text' } as any },
      { session: null, context: makeContext() },
      undefined,
      0,
      'Post',
    )
    expect(result).toEqual({ id: 'a', title: 'hi', media: { url: 'https://x/y.jpg', size: 99 } })
    // Raw columns must NOT leak.
    expect('m_url' in result).toBe(false)
    expect('m_size' in result).toBe(false)
  })

  it('assembles a partially-populated row (only m_url present)', async () => {
    const row = { id: 'b', m_url: 'https://x/only.jpg' }
    const result = await filterReadableFields(
      row,
      fields,
      { session: null, context: makeContext() },
      undefined,
      0,
      'Post',
    )
    expect(result).toEqual({ id: 'b', media: { url: 'https://x/only.jpg', size: 0 } })
  })

  it('yields a null logical value when the columns are empty', async () => {
    const row = { id: 'c', m_url: null, m_size: null }
    const result = await filterReadableFields(
      row,
      fields,
      { session: null, context: makeContext() },
      undefined,
      0,
      'Post',
    )
    expect(result).toEqual({ id: 'c', media: null })
  })

  it('leaves the field absent when its columns were not selected', async () => {
    const row = { id: 'd', title: 'no media columns' }
    const result = await filterReadableFields(
      row,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inline field configs
      { ...fields, title: { type: 'text' } as any },
      { session: null, context: makeContext() },
      undefined,
      0,
      'Post',
    )
    expect(result).toEqual({ id: 'd', title: 'no media columns' })
    expect('media' in result).toBe(false)
  })
})

describe('multi-column write split (executeFieldResolveInputHooks)', () => {
  const fields = { media: multiColumnField() }

  it('splits the logical value into per-part columns and removes the logical key', async () => {
    const inputData = { media: { url: 'https://x/y.jpg', size: 99 } }
    const result = await executeFieldResolveInputHooks(
      inputData,
      { ...inputData },
      fields,
      'create',
      makeContext(),
      'Post',
    )
    expect(result).toEqual({ m_url: 'https://x/y.jpg', m_size: 99 })
    expect('media' in result).toBe(false)
  })

  it('splitting null clears all per-part columns', async () => {
    const inputData = { media: null }
    const result = await executeFieldResolveInputHooks(
      inputData,
      { ...inputData },
      fields,
      'update',
      makeContext(),
      'Post',
    )
    expect(result).toEqual({ m_url: null, m_size: null })
  })

  it('does not touch the columns when the logical field is absent from the write', async () => {
    const inputData = { title: 'no media in payload' }
    const result = await executeFieldResolveInputHooks(
      inputData,
      { ...inputData },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inline field configs
      { ...fields, title: { type: 'text' } as any },
      'update',
      makeContext(),
      'Post',
    )
    expect(result).toEqual({ title: 'no media in payload' })
    expect('m_url' in result).toBe(false)
  })
})

describe('multi-column write split respects field-level write access', () => {
  it('does NOT write any per-part columns when update access is denied', async () => {
    const fields = { media: multiColumnField({ update: () => false }) }
    const inputData = { media: { url: 'https://x/y.jpg', size: 99 } }
    const result = await executeFieldResolveInputHooks(
      inputData,
      { ...inputData },
      fields,
      'update',
      makeContext(),
      'Post',
    )
    // The logical key is dropped (it is not a real column) AND none of its
    // per-part columns are written — identical to how filterWritableFields
    // drops a denied single-column field.
    expect(result).toEqual({})
    expect('media' in result).toBe(false)
    expect('m_url' in result).toBe(false)
    expect('m_size' in result).toBe(false)
  })

  it('does NOT write any per-part columns when create access is denied', async () => {
    const fields = { media: multiColumnField({ create: () => false }) }
    const inputData = { media: { url: 'https://x/y.jpg', size: 99 } }
    const result = await executeFieldResolveInputHooks(
      inputData,
      { ...inputData },
      fields,
      'create',
      makeContext(),
      'Post',
    )
    expect(result).toEqual({})
    expect('m_url' in result).toBe(false)
  })

  it('still splits/writes the columns when write access is granted', async () => {
    const fields = { media: multiColumnField({ update: () => true, create: () => true }) }
    const inputData = { media: { url: 'https://x/y.jpg', size: 99 } }
    const result = await executeFieldResolveInputHooks(
      inputData,
      { ...inputData },
      fields,
      'update',
      makeContext(),
      'Post',
    )
    expect(result).toEqual({ m_url: 'https://x/y.jpg', m_size: 99 })
    expect('media' in result).toBe(false)
  })

  it('denying the OTHER operation does not block the write (update field, create op)', async () => {
    // A field that denies `update` must still be writable on `create`.
    const fields = { media: multiColumnField({ update: () => false }) }
    const inputData = { media: { url: 'https://x/y.jpg', size: 99 } }
    const result = await executeFieldResolveInputHooks(
      inputData,
      { ...inputData },
      fields,
      'create',
      makeContext(),
      'Post',
    )
    expect(result).toEqual({ m_url: 'https://x/y.jpg', m_size: 99 })
  })

  it('sudo bypasses the field-access gate and still splits', async () => {
    const fields = { media: multiColumnField({ update: () => false }) }
    const inputData = { media: { url: 'https://x/y.jpg', size: 99 } }
    const result = await executeFieldResolveInputHooks(
      inputData,
      { ...inputData },
      fields,
      'update',
      makeContext({ isSudo: true }),
      'Post',
    )
    expect(result).toEqual({ m_url: 'https://x/y.jpg', m_size: 99 })
  })

  it('a multi-column field WITHOUT field-level access splits exactly as before', async () => {
    const fields = { media: multiColumnField() }
    const inputData = { media: { url: 'https://x/y.jpg', size: 99 } }
    const result = await executeFieldResolveInputHooks(
      inputData,
      { ...inputData },
      fields,
      'update',
      makeContext(),
      'Post',
    )
    expect(result).toEqual({ m_url: 'https://x/y.jpg', m_size: 99 })
  })
})
