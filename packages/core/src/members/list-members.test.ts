import { readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { FieldConfig, OpenSaasConfig } from '../config/types.js'
import { deriveContract } from '../contract/derive.js'
import { relationship, text, timestamp, virtual } from '../fields/index.js'
import { validateConfigFields } from '../validation/field-config.js'
import { validateDatabaseConfig } from '../validation/database-config.js'
import { validateRelations } from '../validation/relations.js'
import { resolveListMember, resolveListMembers, type ListMember } from './list-members.js'

const addressField: FieldConfig = {
  type: 'address',
  outputType: 'string',
  getContractField: () => ({
    kind: 'columns',
    columns: [
      { name: 'address_line', type: { pack: 'pg', type: 'text' }, nullable: true },
      { name: 'address_city', type: { pack: 'pg', type: 'text' }, nullable: true },
    ],
  }),
}

const moneyField: FieldConfig = {
  type: 'money',
  outputType: 'string',
  getContractField: (name) => ({
    kind: 'columns',
    columns: [
      { name, type: { pack: 'pg', type: 'text' }, nullable: true },
      { name: `${name}_currency`, type: { pack: 'pg', type: 'text' }, nullable: true },
    ],
  }),
}

function fixture(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      Author: {
        db: { timestamps: true },
        fields: {
          name: text(),
          posts: relationship({ ref: 'Post.author', many: true }),
          profile: relationship({ ref: 'Profile.author' }),
        },
      },
      Profile: {
        db: { timestamps: true },
        fields: {
          bio: text(),
          author: relationship({ ref: 'Author.profile' }),
          authorId: text(),
          createdAt: timestamp(),
        },
      },
      Post: {
        fields: {
          title: text(),
          author: relationship({ ref: 'Author.posts', db: { foreignKey: { map: 'author_ref' } } }),
          category: relationship({ ref: 'Category' }),
          address: addressField,
          price: moneyField,
          summary: virtual({ type: 'string', hooks: { resolveOutput: () => 'summary' } }),
        },
      },
      Category: {
        fields: { name: text() },
      },
      Settings: {
        isSingleton: true,
        fields: { siteName: text() },
      },
    },
  }
}

const config = fixture()

function storageOf(member: ListMember | undefined): unknown {
  return member?.kind === 'field' ? member.storage : undefined
}

describe('resolveListMember', () => {
  const rows: Array<[string, string, string, Record<string, unknown> | undefined]> = [
    ['Category', 'name', 'a declared scalar', { kind: 'field', storage: { kind: 'column' } }],
    [
      'Category',
      'from_Post_category',
      'the Synthetic back-relation of a list-only ref',
      {
        kind: 'syntheticBackRelation',
        sourceList: 'Post',
        sourceField: 'category',
        many: true,
      },
    ],
    [
      'Post',
      'category',
      'a list-only ref',
      {
        kind: 'field',
        storage: {
          kind: 'relation',
          relatedList: 'Category',
          many: false,
          foreignKey: 'categoryId',
          inverse: { field: 'from_Post_category', synthetic: true },
        },
      },
    ],
    [
      'Post',
      'categoryId',
      'the foreign key a list-only ref owns',
      { kind: 'foreignKey', field: 'category', relatedList: 'Category', column: 'categoryId' },
    ],
    [
      'Post',
      'author',
      'the to-one side of a one-to-many',
      {
        kind: 'field',
        storage: {
          kind: 'relation',
          relatedList: 'Author',
          many: false,
          foreignKey: 'authorId',
        },
      },
    ],
    [
      'Post',
      'authorId',
      'a mapped foreign-key column, under its model name',
      { kind: 'foreignKey', field: 'author', relatedList: 'Author', column: 'author_ref' },
    ],
    ['Post', 'author_ref', 'the physical spelling of a mapped key', undefined],
    [
      'Author',
      'posts',
      'the to-many side of a one-to-many',
      {
        kind: 'field',
        storage: { kind: 'relation', relatedList: 'Post', many: true, foreignKey: undefined },
      },
    ],
    ['Author', 'postsId', 'a to-many side', undefined],
    [
      'Author',
      'profile',
      'the owning side of a one-to-one',
      {
        kind: 'field',
        storage: { kind: 'relation', relatedList: 'Profile', many: false, foreignKey: 'profileId' },
      },
    ],
    [
      'Author',
      'profileId',
      'the key the owning side of a one-to-one holds',
      { kind: 'foreignKey', field: 'profile', relatedList: 'Profile' },
    ],
    [
      'Profile',
      'author',
      'the non-owning side of a one-to-one',
      {
        kind: 'field',
        storage: { kind: 'relation', relatedList: 'Author', many: false, foreignKey: undefined },
      },
    ],
    [
      'Profile',
      'authorId',
      'a sibling scalar named like a key this side does not own',
      { kind: 'field', storage: { kind: 'column' } },
    ],
    [
      'Post',
      'address',
      'a multi-column field with distinct part names',
      { kind: 'field', storage: { kind: 'columns', parts: ['address_line', 'address_city'] } },
    ],
    ['Post', 'address_line', 'a part column', { kind: 'partColumn', field: 'address' }],
    ['Post', 'address_city', 'a part column', { kind: 'partColumn', field: 'address' }],
    [
      'Post',
      'price',
      'a multi-column field whose first part shares its name',
      { kind: 'field', storage: { kind: 'columns', parts: ['price', 'price_currency'] } },
    ],
    [
      'Post',
      'price_currency',
      'the remaining part of that field',
      { kind: 'partColumn', field: 'price' },
    ],
    ['Post', 'summary', 'a virtual field', { kind: 'field', storage: { kind: 'computed' } }],
    ['Post', 'id', 'the id', { kind: 'systemField' }],
    ['Post', 'createdAt', 'an undeclared createdAt with timestamps off', undefined],
    ['Post', 'updatedAt', 'an undeclared updatedAt with timestamps off', undefined],
    ['Author', 'createdAt', 'createdAt with timestamps on', { kind: 'systemField' }],
    ['Author', 'updatedAt', 'updatedAt with timestamps on', { kind: 'systemField' }],
    [
      'Profile',
      'createdAt',
      'a createdAt declared by hand with timestamps on',
      { kind: 'field', storage: { kind: 'column' } },
    ],
    ['Profile', 'updatedAt', 'the auto updatedAt beside it', { kind: 'systemField' }],
    ['Settings', 'siteName', "a singleton's field", { kind: 'field', storage: { kind: 'column' } }],
    ['Category', 'categoryId', 'the far side of a list-only ref', undefined],
  ]

  it.each(rows)('%s.%s is %s', (listKey, name, _description, expected) => {
    const member = resolveListMember(config, listKey, name)
    if (expected === undefined) {
      expect(member).toBeUndefined()
      return
    }
    expect(member).toMatchObject({ name, ...expected })
  })

  it('lists a part that shares its field name among that field’s parts', () => {
    expect(storageOf(resolveListMember(config, 'Post', 'price'))).toEqual({
      kind: 'columns',
      parts: ['price', 'price_currency'],
    })
  })

  it('hands back the declared field config itself', () => {
    const member = resolveListMember(config, 'Post', 'title')
    expect(member?.kind === 'field' ? member.field : undefined).toBe(config.lists.Post.fields.title)
  })
})

describe('resolveListMembers', () => {
  const rows: Array<[string, boolean, string[]]> = [
    ['Author', false, ['id', 'createdAt', 'updatedAt']],
    ['Profile', false, ['id', 'updatedAt']],
    ['Post', false, ['id']],
    ['Settings', true, ['id']],
  ]

  it.each(rows)('%s: singleton %s, system fields %j', (listKey, singleton, systemFields) => {
    const members = resolveListMembers(config, listKey)
    expect(members.singleton).toBe(singleton)
    expect(members.systemFields).toEqual(systemFields)
  })

  it('enumerates exactly the names a list answers to', () => {
    expect([...resolveListMembers(config, 'Post').members.keys()].sort()).toEqual(
      [
        'address',
        'address_city',
        'address_line',
        'author',
        'authorId',
        'category',
        'categoryId',
        'id',
        'price',
        'price_currency',
        'summary',
        'title',
      ].sort(),
    )
  })

  it('is memoised against the config object', () => {
    const own = fixture()
    const members = resolveListMembers(own, 'Post')
    expect(resolveListMembers(own, 'Post')).toBe(members)

    const copy: OpenSaasConfig = { ...own }
    const fromCopy = resolveListMembers(copy, 'Post')
    expect(fromCopy).not.toBe(members)
    expect(fromCopy.members).toEqual(members.members)
  })

  it('resolves a Synthetic back-relation by lookup, describing no field again once built', () => {
    const own = fixture()
    const calls = new Map<string, number>()
    for (const [listKey, listConfig] of Object.entries(own.lists)) {
      for (const [fieldKey, field] of Object.entries(listConfig.fields)) {
        const describe = field.getContractField
        if (describe === undefined) continue
        const key = `${listKey}.${fieldKey}`
        listConfig.fields[fieldKey] = {
          ...field,
          getContractField: (...args) => {
            calls.set(key, (calls.get(key) ?? 0) + 1)
            return describe(...args)
          },
        }
      }
    }

    const resolveEverywhere = (): void => {
      for (const listKey of Object.keys(own.lists)) {
        resolveListMember(own, listKey, 'from_Post_category')
      }
    }
    resolveEverywhere()
    const afterFirst = new Map(calls)
    for (let round = 0; round < 5; round += 1) resolveEverywhere()

    expect(resolveListMember(own, 'Category', 'from_Post_category')?.kind).toBe(
      'syntheticBackRelation',
    )
    expect(calls).toEqual(afterFirst)
  })

  it('throws for a list the config does not have', () => {
    expect(() => resolveListMembers(config, 'Nope')).toThrow('List "Nope" is not in the config')
  })
})

function generateError(refused: OpenSaasConfig): string {
  const [fieldError] = validateConfigFields(refused)
  if (fieldError !== undefined) return fieldError.message
  const [refusal] = [...validateDatabaseConfig(refused), ...validateRelations(refused)]
  if (refusal !== undefined) return refusal.message
  try {
    deriveContract(refused)
  } catch (error) {
    if (error instanceof Error) return error.message
  }
  throw new Error('generate accepts this config')
}

function withLists(lists: OpenSaasConfig['lists']): OpenSaasConfig {
  return { db: { provider: 'postgresql' }, lists }
}

describe('a config generate refuses', () => {
  const rows: Array<[string, OpenSaasConfig, string]> = [
    [
      'a missing relationship target',
      withLists({ Post: { fields: { category: relationship({ ref: 'Nope' }) } } }),
      'Post',
    ],
    [
      'both sides of a one-to-one claiming the key',
      withLists({
        Author: {
          fields: {
            profile: relationship({ ref: 'Profile.author', db: { foreignKey: true } }),
          },
        },
        Profile: {
          fields: {
            author: relationship({ ref: 'Author.profile', db: { foreignKey: true } }),
          },
        },
      }),
      'Profile',
    ],
    [
      'a ref with an empty field',
      withLists({
        Post: { fields: { author: relationship({ ref: 'Author.' }) } },
        Author: { fields: { name: text() } },
      }),
      'Post',
    ],
    [
      'a ref to a field that is not there',
      withLists({
        Post: { fields: { author: relationship({ ref: 'Author.posts' }) } },
        Author: { fields: { name: text() } },
      }),
      'Post',
    ],
    [
      'a ref whose other end does not ref back',
      withLists({
        Post: { fields: { author: relationship({ ref: 'Author.posts' }) } },
        Author: { fields: { posts: relationship({ ref: 'Post.editor', many: true }) } },
      }),
      'Author',
    ],
    [
      'a scalar colliding with a key the same list owns',
      withLists({
        Post: {
          fields: { author: relationship({ ref: 'Author' }), authorId: text() },
        },
        Author: { fields: { name: text() } },
      }),
      'Post',
    ],
    [
      'a field colliding with a Synthetic back-relation',
      withLists({
        Post: { fields: { category: relationship({ ref: 'Category' }) } },
        Category: { fields: { from_Post_category: text() } },
      }),
      'Category',
    ],
  ]

  it.each(rows)('%s throws the message generate gives', (_description, refused, listKey) => {
    const message = generateError(refused)
    expect(() => resolveListMembers(refused, listKey)).toThrow(message)
  })
})

describe('the resolver module', () => {
  const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))
  const here = path.dirname(fileURLToPath(import.meta.url))

  function bareImportsOf(entry: string): Set<string> {
    const seen = new Set<string>()
    const bare = new Set<string>()
    const pending = [entry]
    while (pending.length > 0) {
      const file = pending.pop()
      if (file === undefined || seen.has(file)) continue
      seen.add(file)
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(
        /^(?:import|export)(?!\s+type\b)[^'"]*?from\s+'([^']+)'/gm,
      )) {
        const specifier = match[1]
        if (specifier === undefined) continue
        if (specifier.startsWith('.')) {
          pending.push(path.resolve(path.dirname(file), specifier.replace(/\.js$/, '.ts')))
        } else {
          bare.add(specifier)
        }
      }
    }
    return bare
  }

  it('reaches no Node builtin through its value imports', () => {
    const bare = [...bareImportsOf(path.join(here, 'list-members.ts'))]
    expect(bare.length).toBeGreaterThan(0)
    expect(bare.filter((specifier) => builtins.has(specifier))).toEqual([])
  })
})
