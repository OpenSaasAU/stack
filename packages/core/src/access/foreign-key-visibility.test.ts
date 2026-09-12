import { describe, it, expect, vi } from 'vitest'
import {
  resolveForeignKeyVisibility,
  emptyForeignKeyVisibilityMap,
} from './foreign-key-visibility.js'
import { filterReadableFields } from './field-visibility.js'
import { noDependencyAdditions } from './declared-dependencies.js'
import type { OpenSaasConfig, FieldConfig } from '../config/types.js'
import type { AccessContext } from './types.js'

/**
 * Regression coverage for issue #1243 on the legacy surface:
 * `buildAccessScopedInclude`/`resolveToOneAccessVisibility` only ever resolve
 * a relation the caller's own `requestedInclude` names, so a to-one nobody
 * included had nothing narrowing its raw `<field>Id` column — it passed
 * through `filterReadableFields` unchanged, via the generic fallback for a
 * key with no `fieldConfigs` entry. `resolveForeignKeyVisibility` closes that
 * gap; these tests exercise it together with `filterReadableFields`, the same
 * pairing `secured/read.ts` uses for the live surface
 * (`secured/foreign-key-visibility.test.ts`).
 */

function rel(ref: string, access?: FieldConfig['access']): FieldConfig {
  return { type: 'relationship', ref, many: false, access } as unknown as FieldConfig
}

function makeContext(ormHandle: Record<string, unknown> = {}): AccessContext {
  return {
    session: null,
    _isSudo: false,
    _resolveOutputChain: [],
    ormHandle,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal context for unit test
  } as any
}

function config(ownerQueryAccess: unknown): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      Item: {
        fields: {
          title: { type: 'text' } as FieldConfig,
          owner: rel('Owner'),
          secret: rel('Owner', { read: () => false }),
        },
        access: { operation: { query: () => true } },
      },
      Owner: {
        fields: { handle: { type: 'text' } as FieldConfig },
        access: { operation: { query: ownerQueryAccess } },
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
  } as any as OpenSaasConfig
}

describe('resolveForeignKeyVisibility (issue #1243)', () => {
  it('records nothing for a relation the caller included', async () => {
    const cfg = config(() => true)
    const context = makeContext()

    const map = await resolveForeignKeyVisibility(
      [{ id: 'i1', ownerId: 'o1' }],
      cfg.lists.Item.fields,
      { owner: true },
      { session: null, context },
      cfg,
      'Item',
    )

    expect(map.ownerId).toBeUndefined()
  })

  it('records "open" for a relation whose query access is fully allowed', async () => {
    const cfg = config(() => true)
    const context = makeContext()

    const map = await resolveForeignKeyVisibility(
      [{ id: 'i1', ownerId: 'o1' }],
      cfg.lists.Item.fields,
      {},
      { session: null, context },
      cfg,
      'Item',
    )

    expect(map.ownerId).toEqual({ kind: 'open' })
  })

  it('records a denial with no query when the related list denies query access outright', async () => {
    const findMany = vi.fn()
    const cfg = config(() => false)
    const context = makeContext({ Owner: { findMany } })

    const map = await resolveForeignKeyVisibility(
      [{ id: 'i1', ownerId: 'o1' }],
      cfg.lists.Item.fields,
      {},
      { session: null, context },
      cfg,
      'Item',
    )

    expect(map.ownerId).toEqual({ kind: 'denied' })
    expect(findMany).not.toHaveBeenCalled()
  })

  it('batches every row into one existence check when query access is a filter', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'o1' }])
    const cfg = config(() => ({ handle: { equals: 'mine' } }))
    const context = makeContext({ Owner: { findMany } })

    const map = await resolveForeignKeyVisibility(
      [
        { id: 'i1', ownerId: 'o1' },
        { id: 'i2', ownerId: 'o2' },
        { id: 'i3', ownerId: null },
      ],
      cfg.lists.Item.fields,
      {},
      { session: null, context },
      cfg,
      'Item',
    )

    expect(findMany).toHaveBeenCalledTimes(1)
    expect(findMany).toHaveBeenCalledWith({
      where: { AND: [{ handle: { equals: 'mine' } }, { id: { in: ['o1', 'o2'] } }] },
      select: { id: true },
    })
    expect(map.ownerId).toEqual({ kind: 'scoped', ids: new Set(['o1']) })
  })
})

describe('filterReadableFields consuming a resolved ForeignKeyVisibilityMap', () => {
  it('nulls a foreign key the related list denies outright', async () => {
    const cfg = config(() => false)
    const row = { id: 'i1', title: 'x', ownerId: 'o1' }

    const result = await filterReadableFields(
      row,
      cfg.lists.Item.fields,
      { session: null, context: makeContext() },
      cfg,
      0,
      'Item',
      noDependencyAdditions(),
      undefined,
      undefined,
      undefined,
      undefined,
      { ownerId: { kind: 'denied' } },
    )

    expect((result as Record<string, unknown>).ownerId).toBeNull()
  })

  it('nulls a foreign key excluded by a resolved filter, and keeps one included in it', async () => {
    const cfg = config(() => ({ handle: { equals: 'mine' } }))

    const visible = await filterReadableFields(
      { id: 'i1', title: 'x', ownerId: 'o1' },
      cfg.lists.Item.fields,
      { session: null, context: makeContext() },
      cfg,
      0,
      'Item',
      noDependencyAdditions(),
      undefined,
      undefined,
      undefined,
      undefined,
      { ownerId: { kind: 'scoped', ids: new Set(['o1']) } },
    )
    expect((visible as Record<string, unknown>).ownerId).toBe('o1')

    const notVisible = await filterReadableFields(
      { id: 'i2', title: 'y', ownerId: 'o2' },
      cfg.lists.Item.fields,
      { session: null, context: makeContext() },
      cfg,
      0,
      'Item',
      noDependencyAdditions(),
      undefined,
      undefined,
      undefined,
      undefined,
      { ownerId: { kind: 'scoped', ids: new Set(['o1']) } },
    )
    expect((notVisible as Record<string, unknown>).ownerId).toBeNull()
  })

  it('nulls a foreign key whose owning relationship field denies read at the field level', async () => {
    const cfg = config(() => true)

    const result = await filterReadableFields(
      { id: 'i1', title: 'x', secretId: 'o1' },
      cfg.lists.Item.fields,
      { session: null, context: makeContext() },
      cfg,
      0,
      'Item',
      noDependencyAdditions(),
      undefined,
      undefined,
      undefined,
      undefined,
      // `resolveForeignKeyVisibility` records "open" here — the related
      // list's own `query` access is fully allowed — but the field-level
      // `read` rule on `secret` denies unconditionally, and that check runs
      // independently of what the map says.
      { secretId: { kind: 'open' } },
    )

    expect((result as Record<string, unknown>).secretId).toBeNull()
  })

  it('leaves a foreign key untouched when nothing in the map names it', async () => {
    const cfg = config(() => true)

    const result = await filterReadableFields(
      { id: 'i1', title: 'x', ownerId: 'o1' },
      cfg.lists.Item.fields,
      { session: null, context: makeContext() },
      cfg,
      0,
      'Item',
      noDependencyAdditions(),
      undefined,
      undefined,
      undefined,
      undefined,
      emptyForeignKeyVisibilityMap(),
    )

    expect((result as Record<string, unknown>).ownerId).toBe('o1')
  })
})
