import { describe, it, expect } from 'vitest'
import { list } from '../config/index.js'
import { text, relationship, integer } from '../fields/index.js'
import type { OpenSaasConfig } from '../config/types.js'
import type { AccessContext } from './types.js'
import {
  resolveRelationshipLabelFilters,
  isToOneRelationshipField,
} from './relationship-label-filter.js'

/**
 * `resolveRelationshipLabelFilters` used to fold the related list's `query`
 * access into a to-one relationship label filter's nested `is` clause
 * (issue #749). Since #916, the engine itself scopes every relation filter in
 * `where` (`buildAccessScopedWhere`), including this exact `{ is: {...} } }`
 * shape, so this resolver's own fold is redundant and has been removed — it
 * is now a pass-through, kept exported only for API compatibility. These
 * tests pin that pass-through behavior; `access-filter.test.ts` and
 * `context.test.ts` cover the actual access-scoping this resolver used to do.
 */

function makeConfig(): OpenSaasConfig {
  return {
    db: { provider: 'sqlite', prismaClientConstructor: () => null as never },
    lists: {
      User: list({
        fields: { name: text(), active: integer() },
        access: { operation: { query: () => ({ active: { equals: 1 } }) } },
      }),
      Post: list({
        fields: {
          title: text(),
          views: integer(),
          author: relationship({ ref: 'User.posts' }),
          widget: relationship({ ref: 'Widget' }),
        },
        access: { operation: { query: () => true } },
      }),
      // Widget ships closed (no access block) → query denied by default.
      Widget: list({ fields: { name: text() } }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
  } as any
}

function makeContext(): AccessContext {
  return {
    session: null,
    _isSudo: false,
    _resolveOutputChain: [],
    db: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal context for unit test
  } as any
}

describe('isToOneRelationshipField', () => {
  const config = makeConfig()
  const postFields = config.lists.Post.fields

  it('is true only for a to-one relationship', () => {
    expect(isToOneRelationshipField(postFields.author)).toBe(true)
    expect(isToOneRelationshipField(postFields.widget)).toBe(true)
    expect(isToOneRelationshipField(postFields.title)).toBe(false)
  })
})

describe('resolveRelationshipLabelFilters (pass-through since #916)', () => {
  it('returns a plain where unchanged', async () => {
    const config = makeConfig()
    const where = { title: { contains: 'hello' } }
    const resolved = await resolveRelationshipLabelFilters(
      where,
      config.lists.Post,
      { session: null, context: makeContext() },
      config,
    )
    expect(resolved).toBe(where)
  })

  it('returns a to-one label-filter `is` clause unchanged — the engine scopes it now', async () => {
    const config = makeConfig()
    const where = { author: { is: { name: { contains: 'Ada' } } } }
    const resolved = await resolveRelationshipLabelFilters(
      where,
      config.lists.Post,
      { session: null, context: makeContext() },
      config,
    )
    expect(resolved).toBe(where)
  })

  it('returns a label filter against a fully denied related list unchanged too', async () => {
    const config = makeConfig()
    const where = { widget: { is: { name: { contains: 'Gadget' } } } }
    const resolved = await resolveRelationshipLabelFilters(
      where,
      config.lists.Post,
      { session: null, context: makeContext() },
      config,
    )
    expect(resolved).toBe(where)
  })

  it('returns a where with nested AND/label-filter members unchanged', async () => {
    const config = makeConfig()
    const where = {
      AND: [{ title: { contains: 'hello' } }, { author: { is: { name: { contains: 'Ada' } } } }],
    }
    const resolved = await resolveRelationshipLabelFilters(
      where,
      config.lists.Post,
      { session: null, context: makeContext() },
      config,
    )
    expect(resolved).toBe(where)
  })

  it('returns undefined unchanged when there is no where at all', async () => {
    const config = makeConfig()
    const resolved = await resolveRelationshipLabelFilters(
      undefined,
      config.lists.Post,
      { session: null, context: makeContext() },
      config,
    )
    expect(resolved).toBeUndefined()
  })
})
