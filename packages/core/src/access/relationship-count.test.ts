import { describe, it, expect } from 'vitest'
import { list } from '../config/index.js'
import { text, relationship, integer } from '../fields/index.js'
import type { OpenSaasConfig } from '../config/types.js'
import type { AccessContext } from './types.js'
import { buildRelationshipCountSelect, isToManyRelationshipField } from './relationship-count.js'

/**
 * Access-scoped to-many relationship counts (issue #732). Verifies:
 *  • the filtered `_count` select folds in the related list's query access,
 *  • a denied related list is omitted (its count renders as 0, never a leak).
 *
 * The count-filter resolver is gone with ADR-0055: a count comparison shrinks
 * to presence, which the engine's own lowering handles.
 */

// User (published-only for anon via a filter), plus a Widget list that is fully
// closed by default (no query access) to prove the denied path.
function makeConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      User: list({
        fields: {
          name: text(),
          posts: relationship({ ref: 'Post.author', many: true }),
          widgets: relationship({ ref: 'Widget', many: true }),
          manager: relationship({ ref: 'User' }), // to-one — never counted
        },
        access: { operation: { query: () => true } },
      }),
      Post: list({
        fields: { title: text(), views: integer(), author: relationship({ ref: 'User.posts' }) },
        // Only published posts are visible → the count must be access-scoped.
        access: { operation: { query: () => ({ status: { equals: 'published' } }) } },
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

describe('isToManyRelationshipField', () => {
  const config = makeConfig()
  const userFields = config.lists.User.fields
  it('is true only for a to-many relationship', () => {
    expect(isToManyRelationshipField(userFields.posts)).toBe(true)
    expect(isToManyRelationshipField(userFields.widgets)).toBe(true)
    expect(isToManyRelationshipField(userFields.manager)).toBe(false)
    expect(isToManyRelationshipField(userFields.name)).toBe(false)
  })
})

describe('buildRelationshipCountSelect', () => {
  it("folds the related list's query filter into each to-many count and omits denied/to-one", async () => {
    const config = makeConfig()
    const select = await buildRelationshipCountSelect(
      config.lists.User,
      { session: null, context: makeContext() },
      config,
    )
    // `posts` → access-scoped where; `widgets` → denied (omitted); `manager` →
    // to-one (never counted).
    expect(select).toEqual({ posts: { where: { status: { equals: 'published' } } } })
  })

  it('uses a bare `true` when the related list is fully readable', async () => {
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: {
        Tag: list({ fields: { name: text() }, access: { operation: { query: () => true } } }),
        Post: list({ fields: { title: text(), tags: relationship({ ref: 'Tag', many: true }) } }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
    } as any
    const select = await buildRelationshipCountSelect(
      config.lists.Post,
      { session: null, context: makeContext() },
      config,
    )
    expect(select).toEqual({ tags: true })
  })

  it('returns undefined when there are no countable to-many relationships', async () => {
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: { Post: list({ fields: { title: text() } }) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
    } as any
    const select = await buildRelationshipCountSelect(
      config.lists.Post,
      { session: null, context: makeContext() },
      config,
    )
    expect(select).toBeUndefined()
  })
})
