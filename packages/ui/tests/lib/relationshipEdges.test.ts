import { describe, expect, it } from 'vitest'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { relationship, text } from '@opensaas/stack-core/fields'
import { resolveToManyEdgePlan } from '../../src/lib/relationshipEdges.js'
import {
  markToManyEdgeWrites,
  markUnwritableRelationships,
  serializeFieldConfigs,
  UNWRITABLE_RELATIONSHIP_REASON,
} from '../../src/lib/serializeFieldConfig.js'

function config(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      User: {
        fields: {
          name: text(),
          posts: relationship({ ref: 'Post.author', many: true }),
          // A list-only ref names no back-reference to write through.
          drafts: relationship({ ref: 'Post', many: true }),
        },
      },
      Post: {
        fields: { title: text(), author: relationship({ ref: 'User.posts' }) },
      },
      // An edge across an explicit junction: its rows are created and deleted
      // under the junction's own access, never written by an update.
      Article: {
        fields: { title: text(), tags: relationship({ ref: 'ArticleTag.article', many: true }) },
      },
      Tag: {
        fields: { name: text(), articles: relationship({ ref: 'ArticleTag.tag', many: true }) },
      },
      ArticleTag: {
        fields: {
          article: relationship({ ref: 'Article.tags' }),
          tag: relationship({ ref: 'Tag.articles' }),
        },
      },
    },
  }
}

describe('resolveToManyEdgePlan (ADR-0050)', () => {
  it('names the related list and the column holding the link', () => {
    expect(resolveToManyEdgePlan(config(), 'User', 'posts')).toEqual({
      relatedListKey: 'Post',
      backReferenceField: 'author',
    })
  })

  it('refuses a list-only ref, a to-one, and a field that is not there', () => {
    expect(resolveToManyEdgePlan(config(), 'User', 'drafts')).toBeNull()
    expect(resolveToManyEdgePlan(config(), 'Post', 'author')).toBeNull()
    expect(resolveToManyEdgePlan(config(), 'User', 'name')).toBeNull()
    expect(resolveToManyEdgePlan(config(), 'User', 'nope')).toBeNull()
    expect(resolveToManyEdgePlan(config(), 'Nowhere', 'posts')).toBeNull()
    expect(resolveToManyEdgePlan(config(), 'constructor', 'posts')).toBeNull()
  })

  it('refuses a back-reference that cannot be cleared', () => {
    const withRequiredFk = config()
    withRequiredFk.lists.Post.fields.author = relationship({
      ref: 'User.posts',
      db: { isNullable: false },
    })
    expect(resolveToManyEdgePlan(withRequiredFk, 'User', 'posts')).toBeNull()

    // `RelationshipField` declares no `validation`, but a config can still
    // carry it through the builder's spread — and an author who wrote it means
    // the link is not the form's to clear.
    const withRequiredValidation = config()
    withRequiredValidation.lists.Post.fields.author = {
      ...relationship({ ref: 'User.posts' }),
      validation: { isRequired: true },
    }
    expect(resolveToManyEdgePlan(withRequiredValidation, 'User', 'posts')).toBeNull()
  })

  it('refuses an edge across an explicit junction list', () => {
    expect(resolveToManyEdgePlan(config(), 'Article', 'tags')).toBeNull()
  })

  it('refuses a ref naming a list the config does not declare', () => {
    const broken = config()
    broken.lists.User.fields.posts = relationship({ ref: 'Nowhere.author', many: true })
    expect(resolveToManyEdgePlan(broken, 'User', 'posts')).toBeNull()
  })
})

describe('markToManyEdgeWrites', () => {
  function serialize(listKey: string, itemId: string | null | undefined) {
    const c = config()
    const fields = c.lists[listKey].fields
    const serialized = serializeFieldConfigs(fields)
    markUnwritableRelationships(serialized, listKey, fields, c)
    markToManyEdgeWrites(serialized, listKey, fields, c, itemId)
    return serialized
  }

  it('replaces the read-only mark with the plan the writes follow', () => {
    const serialized = serialize('User', 'user-1')
    expect(serialized.posts.edgeWrite).toEqual({
      relatedListKey: 'Post',
      backReferenceField: 'author',
    })
    expect(serialized.posts.readOnly).toBeUndefined()
    expect(serialized.posts.readOnlyReason).toBeUndefined()
  })

  it('leaves a to-many with no writable edge read-only', () => {
    const serialized = serialize('User', 'user-1')
    expect(serialized.drafts.edgeWrite).toBeUndefined()
    expect(serialized.drafts.readOnly).toBe(true)
    expect(serialized.drafts.readOnlyReason).toBe(UNWRITABLE_RELATIONSHIP_REASON)

    const junction = serialize('Article', 'article-1')
    expect(junction.tags.edgeWrite).toBeUndefined()
    expect(junction.tags.readOnly).toBe(true)
  })

  it('writes no plan on a create, where there is no parent id to link to', () => {
    for (const itemId of [undefined, null, '']) {
      const serialized = serialize('User', itemId)
      expect(serialized.posts.edgeWrite).toBeUndefined()
      expect(serialized.posts.readOnly).toBe(true)
    }
  })
})
