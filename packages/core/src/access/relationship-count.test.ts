import { describe, it, expect } from 'vitest'
import { list } from '../config/index.js'
import { text, relationship, integer } from '../fields/index.js'
import type { OpenSaasConfig } from '../config/types.js'
import { isToManyRelationshipField } from './relationship-count.js'

/**
 * Which fields carry a to-many relationship count (issue #732). The scoping of
 * the counts themselves belongs to the secured read's reducers and is proved
 * there (`secured/aggregate.test.ts`).
 */

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
