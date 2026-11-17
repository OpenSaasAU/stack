import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import type { FieldConfig, OpenSaasConfig } from '../config/types.js'
import { relationship, text } from '../fields/index.js'
import { relationMember } from './relation-member.js'
import { assertOrderByReachable, assertWhereReachable } from './where-reachability.js'

const addressField: FieldConfig = {
  type: 'address',
  outputType: 'string',
  getZodSchema: () => z.string().optional(),
  getContractField: () => ({
    kind: 'columns',
    columns: [
      { name: 'address_line', type: { pack: 'pg', type: 'text' }, nullable: true },
      { name: 'address_city', type: { pack: 'pg', type: 'text' }, nullable: true },
    ],
  }),
}

function config(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      User: {
        fields: {
          name: text(),
          posts: relationship({ ref: 'Post.author', many: true }),
          profile: relationship({ ref: 'Profile.user' }),
        },
      },
      Profile: {
        fields: { user: relationship({ ref: 'User.profile', db: { foreignKey: true } }) },
      },
      Post: {
        fields: {
          title: text(),
          author: relationship({ ref: 'User.posts' }),
          category: relationship({ ref: 'Category' }),
        },
      },
      Category: { fields: { name: text(), address: addressField } },
    },
  }
}

const everything = new Set(['User', 'Profile', 'Post', 'Category'])
const without = (listKey: string): ReadonlySet<string> =>
  new Set([...everything].filter((candidate) => candidate !== listKey))
const refusal = (listKey: string, key: string): string =>
  `Cannot query "${listKey}" — "${key}" is not a queryable field of this list.`

describe('assertWhereReachable', () => {
  test('an owned foreign key is refused when its related list is unreachable', () => {
    expect(() =>
      assertWhereReachable({ authorId: { equals: 'u1' } }, config(), 'Post', without('User')),
    ).toThrow(refusal('Post', 'authorId'))
    expect(() =>
      assertWhereReachable({ userId: 'u1' }, config(), 'Profile', without('User')),
    ).toThrow(refusal('Profile', 'userId'))
    expect(() =>
      assertWhereReachable({ authorId: 'u1' }, config(), 'Post', everything),
    ).not.toThrow()
  })

  test('a non-owned foreign key is no member, so it is left for the engine to refuse', () => {
    expect(() =>
      assertWhereReachable({ profileId: 'p1' }, config(), 'User', without('Profile')),
    ).not.toThrow()
  })

  test('a relation is refused when unreachable, and its quantifiers recurse into the related list', () => {
    expect(() =>
      assertWhereReachable({ posts: { some: {} } }, config(), 'User', without('Post')),
    ).toThrow(refusal('User', 'posts'))
    expect(() =>
      assertWhereReachable(
        { OR: [{ posts: { some: { categoryId: 'c1' } } }] },
        config(),
        'User',
        without('Category'),
      ),
    ).toThrow(refusal('Post', 'categoryId'))
    expect(() =>
      assertWhereReachable({ NOT: { posts: 'x' } }, config(), 'User', everything),
    ).not.toThrow()
  })

  test('part columns and their field are scalars, never relations', () => {
    expect(() =>
      assertWhereReachable(
        { address_line: 'a', address_city: { contains: 'b' }, address: 'c' },
        config(),
        'Category',
        new Set(),
      ),
    ).not.toThrow()
  })

  test('a Synthetic back-relation is not recognised here; the engine refuses it as an unknown key', () => {
    expect(() =>
      assertWhereReachable(
        { from_Post_category: { some: { authorId: 'u1' } } },
        config(),
        'Category',
        new Set(),
      ),
    ).not.toThrow()
  })

  test('an unknown name and a system field pass through untouched', () => {
    expect(() =>
      assertWhereReachable({ nope: 1, id: 'x' }, config(), 'Post', new Set()),
    ).not.toThrow()
  })
})

describe('assertOrderByReachable', () => {
  test('refuses an owned foreign key into an unreachable list, in either argument shape', () => {
    expect(() =>
      assertOrderByReachable({ authorId: 'asc' }, config(), 'Post', without('User')),
    ).toThrow(refusal('Post', 'authorId'))
    expect(() =>
      assertOrderByReachable(
        [{ title: 'asc' }, 'junk', { authorId: 'desc' }],
        config(),
        'Post',
        everything,
      ),
    ).not.toThrow()
  })
})

describe('relationMember', () => {
  test('answers only for a declared relationship field, with its ownership', () => {
    expect(relationMember(config(), 'Post', 'author')).toEqual({
      relatedList: 'User',
      ownsForeignKey: true,
    })
    expect(relationMember(config(), 'User', 'posts')).toEqual({
      relatedList: 'Post',
      ownsForeignKey: false,
    })
    expect(relationMember(config(), 'User', 'profile')).toEqual({
      relatedList: 'Profile',
      ownsForeignKey: false,
    })
    for (const name of ['title', 'authorId', 'id', 'nope']) {
      expect(relationMember(config(), 'Post', name)).toBeUndefined()
    }
    expect(relationMember(config(), 'Category', 'address_line')).toBeUndefined()
    expect(relationMember(config(), 'Category', 'from_Post_category')).toBeUndefined()
  })
})
