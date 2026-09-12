import { describe, it, expect } from 'vitest'
import type { FieldConfig, OpenSaasConfig } from '@opensaas/stack-core'
import {
  JUNCTION_EDGE_RELATIONSHIP_REASON,
  markUnwritableRelationships,
  serializeFieldConfig,
  serializeFieldConfigs,
  UNWRITABLE_RELATIONSHIP_REASON,
} from '../../src/lib/serializeFieldConfig.js'

function makeFields(fields: Record<string, Record<string, unknown>>): Record<string, FieldConfig> {
  return fields as unknown as Record<string, FieldConfig>
}

/**
 * `Profile.user` holds the one-to-one column (`Profile` sorts before `User`),
 * so `User.profile` is the non-owning end — a fact no field config carries.
 */
function makeConfig(): OpenSaasConfig {
  return {
    db: { provider: 'sqlite', url: 'file:./test.db' },
    lists: {
      User: {
        fields: { name: { type: 'text' }, profile: { type: 'relationship', ref: 'Profile.user' } },
      },
      Profile: {
        fields: { bio: { type: 'text' }, user: { type: 'relationship', ref: 'User.profile' } },
      },
    },
  } as unknown as OpenSaasConfig
}

/**
 * The read-only marking `serializeFieldConfig` makes from the field alone.
 *
 * This is the only thing standing behind the STANDALONE forms when they are
 * given no config: they serialize their own field configs and never reach
 * `prepareItemForm`. So it is asserted here, against this function, rather
 * than through a caller that runs `markUnwritableRelationships` over the
 * result and would keep passing without it.
 */
describe('serializeFieldConfig relationship writability', () => {
  it('marks a to-many read-only', () => {
    const { tags } = serializeFieldConfigs(
      makeFields({ tags: { type: 'relationship', ref: 'Tag.posts', many: true } }),
    )

    expect(tags.readOnly).toBe(true)
    expect(tags.readOnlyReason).toBe(UNWRITABLE_RELATIONSHIP_REASON)
  })

  it('leaves a to-one unmarked — it may own the column, which the field cannot say', () => {
    const { author } = serializeFieldConfigs(
      makeFields({ author: { type: 'relationship', ref: 'User.posts' } }),
    )

    expect(author.readOnly).toBeUndefined()
    expect(author.readOnlyReason).toBeUndefined()
  })

  it('leaves a non-relationship field unmarked', () => {
    const fields = makeFields({ title: { type: 'text' } })

    expect(serializeFieldConfig(fields.title).readOnly).toBeUndefined()
  })
})

describe('markUnwritableRelationships', () => {
  it('marks the non-owning end of a one-to-one and leaves the owning end alone', () => {
    const config = makeConfig()

    const userFields = serializeFieldConfigs(config.lists.User.fields)
    markUnwritableRelationships(userFields, 'User', config.lists.User.fields, config)

    const profileFields = serializeFieldConfigs(config.lists.Profile.fields)
    markUnwritableRelationships(profileFields, 'Profile', config.lists.Profile.fields, config)

    expect(userFields.profile.readOnly).toBe(true)
    expect(userFields.profile.readOnlyReason).toBe(UNWRITABLE_RELATIONSHIP_REASON)
    expect(profileFields.user.readOnly).toBeUndefined()
  })

  it('leaves a field alone when its ref names a list the config does not declare', () => {
    const fields = makeFields({ ghost: { type: 'relationship', ref: 'Nowhere.here' } })
    const serialized = serializeFieldConfigs(fields)

    expect(() =>
      markUnwritableRelationships(serialized, 'User', fields, makeConfig()),
    ).not.toThrow()
    expect(serialized.ghost.readOnly).toBeUndefined()
  })
})

/**
 * `Post.tags` is an edge across the explicit junction `PostTag`; `Author.books`
 * is an ordinary to-many whose far end is a child row. Both are `many: true`,
 * so nothing but the whole config separates them.
 */
function junctionConfig(): OpenSaasConfig {
  return {
    db: { provider: 'sqlite', url: 'file:./test.db' },
    lists: {
      Post: {
        fields: {
          title: { type: 'text' },
          tags: { type: 'relationship', ref: 'PostTag.post', many: true },
        },
      },
      Tag: {
        fields: {
          name: { type: 'text' },
          posts: { type: 'relationship', ref: 'PostTag.tag', many: true },
        },
      },
      PostTag: {
        fields: {
          post: { type: 'relationship', ref: 'Post.tags' },
          tag: { type: 'relationship', ref: 'Tag.posts' },
        },
      },
      Author: {
        fields: {
          name: { type: 'text' },
          books: { type: 'relationship', ref: 'Book.author', many: true },
        },
      },
      Book: {
        fields: {
          title: { type: 'text' },
          author: { type: 'relationship', ref: 'Author.books' },
        },
      },
      // A child row with TWO parents and an unmarked column of its own. Every
      // structural test a junction passes, this passes too — only `body`
      // separates them, and nothing requires it.
      Article: {
        fields: {
          title: { type: 'text' },
          comments: { type: 'relationship', ref: 'Comment.article', many: true },
        },
      },
      Commenter: {
        fields: {
          name: { type: 'text' },
          comments: { type: 'relationship', ref: 'Comment.author', many: true },
        },
      },
      Comment: {
        fields: {
          body: { type: 'text' },
          article: { type: 'relationship', ref: 'Article.comments' },
          author: { type: 'relationship', ref: 'Commenter.comments' },
        },
      },
    },
  } as unknown as OpenSaasConfig
}

/**
 * An edge across a junction gained a control (#1329) but did NOT gain a place
 * in this record's write payload, so the mark stays and only the reason moves.
 * Dropping the mark here is the silent data loss the marking exists to stop.
 */
describe('the reason a to-many is read-only names the control that can write it', () => {
  it('points an edge across a junction at its own table, still read-only', () => {
    const config = junctionConfig()
    const fields = serializeFieldConfigs(config.lists.Post.fields)
    markUnwritableRelationships(fields, 'Post', config.lists.Post.fields, config)

    expect(fields.tags.readOnly).toBe(true)
    expect(fields.tags.readOnlyReason).toBe(JUNCTION_EDGE_RELATIONSHIP_REASON)
  })

  it('leaves an ordinary to-many pointing at the other list', () => {
    const config = junctionConfig()
    const fields = serializeFieldConfigs(config.lists.Author.fields)
    markUnwritableRelationships(fields, 'Author', config.lists.Author.fields, config)

    expect(fields.books.readOnly).toBe(true)
    expect(fields.books.readOnlyReason).toBe(UNWRITABLE_RELATIONSHIP_REASON)
  })

  it('leaves an ordinary child row with two parents pointing at the other list', () => {
    const config = junctionConfig()
    for (const listKey of ['Article', 'Commenter']) {
      const fields = serializeFieldConfigs(config.lists[listKey].fields)
      markUnwritableRelationships(fields, listKey, config.lists[listKey].fields, config)

      expect(fields.comments.readOnly).toBe(true)
      expect(fields.comments.readOnlyReason).toBe(UNWRITABLE_RELATIONSHIP_REASON)
    }
  })

  it('leaves an edge demoted to the picker pointing at the other list', () => {
    // Same junction, same two endpoints — only the display mode differs, and
    // with no table on the item view there is no control for the message to
    // name.
    const config = junctionConfig()
    config.lists.Post.fields.tags.ui = { itemView: { displayMode: 'picker' } }
    const fields = serializeFieldConfigs(config.lists.Post.fields)
    markUnwritableRelationships(fields, 'Post', config.lists.Post.fields, config)

    expect(fields.tags.readOnly).toBe(true)
    expect(fields.tags.readOnlyReason).toBe(UNWRITABLE_RELATIONSHIP_REASON)
  })

  it('keeps the reason a cause other than the missing column gave the field', () => {
    const config = junctionConfig()
    const fields = serializeFieldConfigs(config.lists.Post.fields)
    fields.tags.readOnlyReason = 'Locked by the workflow'
    markUnwritableRelationships(fields, 'Post', config.lists.Post.fields, config)

    expect(fields.tags.readOnly).toBe(true)
    expect(fields.tags.readOnlyReason).toBe('Locked by the workflow')
  })
})
