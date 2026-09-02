import { describe, it, expect } from 'vitest'
import { filterReadableFields } from './field-visibility.js'
import { emptyDeclaredOnlyTree } from './declared-dependencies.js'
import type { ToOneAccessVisibilityTree } from './access-filter.js'
import type { OpenSaasConfig, FieldConfig } from '../config/types.js'
import type { AccessContext } from './types.js'

/**
 * Regression coverage for the `filterReadableFields` half of issue #1103: a
 * relation `buildAccessScopedInclude` denied outright is absent from the raw
 * row (Prisma never fetched it), so the main per-field loop — which only
 * ever visits keys `Object.entries(workingItem)` contains — never sees it.
 * The dedicated post-query pass this file exercises is what forces the key
 * present anyway: `null` for a to-one relation (issue #974, pre-existing),
 * `[]` for a to-many one (issue #1103, this fix) — never a silently absent
 * key, which is what previously broke the fragment API's typed contract
 * (`ResultOf` types a to-many relation as an array).
 */

function rel(ref: string, many = false): FieldConfig {
  return { type: 'relationship', ref, many } as unknown as FieldConfig
}

function makeContext(): AccessContext {
  return {
    session: null,
    _isSudo: false,
    _resolveOutputChain: [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal context for unit test
  } as any
}

function config(): OpenSaasConfig {
  return {
    db: { provider: 'sqlite' },
    lists: {
      Author: {
        fields: {
          name: { type: 'text' } as FieldConfig,
          secrets: rel('Secret.author', true),
          profile: rel('Profile.author', false),
          hiddenSecrets: {
            ...rel('Secret.author', true),
            access: { read: () => false },
          } as unknown as FieldConfig,
        },
        access: { operation: { query: () => true } },
      },
      Secret: {
        fields: { value: { type: 'text' } as FieldConfig },
        access: { operation: { query: () => false } },
      },
      Profile: {
        fields: { bio: { type: 'text' } as FieldConfig },
        access: { operation: { query: () => false } },
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
  } as any as OpenSaasConfig
}

// Term ← Bill.term (list-only ref, no field on Term) — the synthetic
// back-relation case, always to-many (#1082).
function syntheticConfig(): OpenSaasConfig {
  return {
    db: { provider: 'sqlite' },
    lists: {
      Term: {
        fields: { name: { type: 'text' } as FieldConfig },
        access: { operation: { query: () => true } },
      },
      Bill: {
        fields: { amount: { type: 'integer' } as FieldConfig, term: rel('Term') },
        access: { operation: { query: () => false } },
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
  } as any as OpenSaasConfig
}

describe('filterReadableFields — denied relations forced present (issues #974 / #1103)', () => {
  it('forces a denied to-many relation to [], not an absent key', async () => {
    const cfg = config()
    const authorRow = { id: 'a1', name: 'A' } // `secrets` absent — never fetched by Prisma
    const toOneVisibility: ToOneAccessVisibilityTree = {
      filters: { secrets: { kind: 'denied' } },
      nested: {},
    }

    const result = await filterReadableFields(
      authorRow,
      cfg.lists.Author.fields,
      { session: null, context: makeContext() },
      cfg,
      0,
      'Author',
      emptyDeclaredOnlyTree(),
      undefined,
      toOneVisibility,
    )

    expect((result as Record<string, unknown>).secrets).toEqual([])
  })

  it('still forces a denied to-one relation to null (regression check, issue #974)', async () => {
    const cfg = config()
    const authorRow = { id: 'a1', name: 'A' } // `profile` absent — never fetched by Prisma
    const toOneVisibility: ToOneAccessVisibilityTree = {
      filters: { profile: { kind: 'denied' } },
      nested: {},
    }

    const result = await filterReadableFields(
      authorRow,
      cfg.lists.Author.fields,
      { session: null, context: makeContext() },
      cfg,
      0,
      'Author',
      emptyDeclaredOnlyTree(),
      undefined,
      toOneVisibility,
    )

    expect((result as Record<string, unknown>).profile).toBeNull()
  })

  it('forces a denied synthetic back-relation to [] — always to-many (#1082 interaction)', async () => {
    const cfg = syntheticConfig()
    const termRow = { id: 't1', name: 'Term 1' } // `from_Bill_term` absent — never fetched
    const toOneVisibility: ToOneAccessVisibilityTree = {
      filters: { from_Bill_term: { kind: 'denied' } },
      nested: {},
    }

    const result = await filterReadableFields(
      termRow,
      cfg.lists.Term.fields,
      { session: null, context: makeContext() },
      cfg,
      0,
      'Term',
      emptyDeclaredOnlyTree(),
      undefined,
      toOneVisibility,
    )

    expect((result as Record<string, unknown>).from_Bill_term).toEqual([])
  })

  it('omits a denied relation entirely when field-level read access also denies it, rather than forcing []', async () => {
    const cfg = config()
    const authorRow = { id: 'a1', name: 'A' }
    const toOneVisibility: ToOneAccessVisibilityTree = {
      filters: { hiddenSecrets: { kind: 'denied' } },
      nested: {},
    }

    const result = await filterReadableFields(
      authorRow,
      cfg.lists.Author.fields,
      { session: null, context: makeContext() },
      cfg,
      0,
      'Author',
      emptyDeclaredOnlyTree(),
      undefined,
      toOneVisibility,
    )

    expect('hiddenSecrets' in result).toBe(false)
  })
})
