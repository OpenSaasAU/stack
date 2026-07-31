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
 * Access-scoped to-one relationship label filters (issue #749). Verifies that
 * `author:Ada` → `{ author: { is: { name: { contains: 'Ada' } } } }` gets the
 * related list's `query` access folded into the nested `is` clause, so a
 * session can never distinguish parent rows by a related field it cannot
 * itself read.
 */

// Post is fully open; User (the `author` relation target) is scoped so only
// active users are queryable; Widget ships fully closed (no access block).
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

describe('resolveRelationshipLabelFilters', () => {
  it('returns the where unchanged when there are no label-filter members', async () => {
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

  it("ANDs the related list's access filter into the nested `is` clause", async () => {
    const config = makeConfig()
    const where = { author: { is: { name: { contains: 'Ada' } } } }
    const resolved = await resolveRelationshipLabelFilters(
      where,
      config.lists.Post,
      { session: null, context: makeContext() },
      config,
    )
    expect(resolved).toEqual({
      author: { is: { AND: [{ active: { equals: 1 } }, { name: { contains: 'Ada' } }] } },
    })
  })

  it('leaves the member unchanged when the related list is fully readable', async () => {
    const config: OpenSaasConfig = {
      db: { provider: 'sqlite', prismaClientConstructor: () => null as never },
      lists: {
        Tag: list({ fields: { name: text() }, access: { operation: { query: () => true } } }),
        Post: list({ fields: { title: text(), tag: relationship({ ref: 'Tag' }) } }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
    } as any
    const where = { tag: { is: { name: { contains: 'news' } } } }
    const resolved = await resolveRelationshipLabelFilters(
      where,
      config.lists.Post,
      { session: null, context: makeContext() },
      config,
    )
    expect(resolved).toEqual(where)
  })

  it('resolves a fully denied related list to a never-matching member (no leak)', async () => {
    const config = makeConfig()
    const where = { widget: { is: { name: { contains: 'Gadget' } } } }
    const resolved = await resolveRelationshipLabelFilters(
      where,
      config.lists.Post,
      { session: null, context: makeContext() },
      config,
    )
    expect(resolved).toEqual({ id: { in: [] } })
  })

  it('preserves sibling conditions, ANDing the resolved id constraint for a denied member', async () => {
    const config = makeConfig()
    const where = {
      AND: [{ title: { contains: 'hello' } }, { widget: { is: { name: { contains: 'Gadget' } } } }],
    }
    const resolved = await resolveRelationshipLabelFilters(
      where,
      config.lists.Post,
      { session: null, context: makeContext() },
      config,
    )
    expect(resolved).toEqual({
      AND: [{ title: { contains: 'hello' } }, { id: { in: [] } }],
    })
  })

  it('preserves sibling conditions alongside the access-scoped nested `is` clause', async () => {
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
    expect(resolved).toEqual({
      AND: [
        { title: { contains: 'hello' } },
        { author: { is: { AND: [{ active: { equals: 1 } }, { name: { contains: 'Ada' } }] } } },
      ],
    })
  })

  it('composes with a to-many count marker member left untouched by this resolver', async () => {
    const config = makeConfig()
    const where = {
      AND: [{ author: { is: { name: { contains: 'Ada' } } } }, { views: { gt: 10 } }],
    }
    const resolved = await resolveRelationshipLabelFilters(
      where,
      config.lists.Post,
      { session: null, context: makeContext() },
      config,
    )
    expect(resolved).toEqual({
      AND: [
        { author: { is: { AND: [{ active: { equals: 1 } }, { name: { contains: 'Ada' } }] } } },
        { views: { gt: 10 } },
      ],
    })
  })
})
