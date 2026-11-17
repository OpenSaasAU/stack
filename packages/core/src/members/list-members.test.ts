import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { builtinModules } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import ts from 'typescript'
import { z } from 'zod'
import type { FieldConfig, OpenSaasConfig } from '../config/types.js'
import { deriveContract } from '../contract/derive.js'
import { relationship, text, timestamp, virtual } from '../fields/index.js'
import { validateConfigFields } from '../validation/field-config.js'
import { validateDatabaseConfig } from '../validation/database-config.js'
import { validateRelations } from '../validation/relations.js'
import { resolveListMember, resolveListMembers, type ListMember } from './list-members.js'

type Part = { name: string; map?: string }

function partsField(...parts: Array<Part | ((fieldKey: string) => Part)>): FieldConfig {
  return {
    type: 'parts',
    outputType: 'string',
    getZodSchema: () => z.string().optional(),
    getContractField: (fieldKey) => ({
      kind: 'columns',
      columns: parts.map((part) => ({
        ...(typeof part === 'function' ? part(fieldKey) : part),
        type: { pack: 'pg', type: 'text' },
        nullable: true,
      })),
    }),
  }
}

const addressField = partsField({ name: 'address_line' }, { name: 'address_city', map: 'city' })

const moneyField = partsField(
  (fieldKey) => ({ name: fieldKey }),
  (fieldKey) => ({ name: `${fieldKey}_currency` }),
)

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
          slug: text({ db: { map: 'post_slug' } }),
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
    [
      'Category',
      'name',
      'a declared scalar',
      { kind: 'field', storage: { kind: 'column', column: 'name' } },
    ],
    [
      'Post',
      'slug',
      'a db.map scalar, under its model name',
      { kind: 'field', storage: { kind: 'column', column: 'post_slug' } },
    ],
    ['Post', 'post_slug', 'the physical spelling of a mapped scalar', undefined],
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
    [
      'Post',
      'address_line',
      'a part column',
      { kind: 'partColumn', field: 'address', column: 'address_line' },
    ],
    [
      'Post',
      'address_city',
      'a mapped part column, under its model name',
      { kind: 'partColumn', field: 'address', column: 'city' },
    ],
    ['Post', 'city', 'the physical spelling of a mapped part', undefined],
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
        'slug',
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

  it('resolves a Synthetic back-relation by lookup, describing each field once', () => {
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
    expect([...afterFirst.keys()].sort()).toEqual(
      Object.entries(own.lists)
        .flatMap(([listKey, listConfig]) =>
          Object.keys(listConfig.fields).map((fieldKey) => `${listKey}.${fieldKey}`),
        )
        .sort(),
    )
    expect(new Set(afterFirst.values())).toEqual(new Set([1]))
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
    [
      'a list-only ref that is many: true',
      withLists({
        Post: { fields: { tags: relationship({ ref: 'Tag', many: true }) } },
        Tag: { fields: { name: text() } },
      }),
      'Tag',
    ],
    [
      'both ends of a relationship many: true',
      withLists({
        Post: { fields: { tags: relationship({ ref: 'Tag.posts', many: true }) } },
        Tag: { fields: { posts: relationship({ ref: 'Post.tags', many: true }) } },
      }),
      'Post',
    ],
    [
      'a field that refs itself',
      withLists({ User: { fields: { partner: relationship({ ref: 'User.partner' }) } } }),
      'User',
    ],
    ['a field named id', withLists({ Post: { fields: { id: text() } } }), 'Post'],
    ['a field named AND', withLists({ Post: { fields: { AND: text() } } }), 'Post'],
    [
      'db.isNullable: false on the non-owning side of a one-to-one',
      withLists({
        Author: { fields: { profile: relationship({ ref: 'Profile.author' }) } },
        Profile: {
          fields: {
            author: relationship({ ref: 'Author.profile', db: { isNullable: false } }),
          },
        },
      }),
      'Author',
    ],
    [
      'a field with no getContractField beside an inverse mismatch',
      withLists({
        Post: {
          fields: {
            author: relationship({ ref: 'Author.posts' }),
            odd: { type: 'odd', getZodSchema: () => z.string().optional() },
          },
        },
        Author: { fields: { posts: relationship({ ref: 'Post.editor', many: true }) } },
      }),
      'Author',
    ],
    [
      'a part column colliding with a declared field',
      withLists({ Post: { fields: { address: addressField, address_city: text() } } }),
      'Post',
    ],
    [
      'two multi-column fields sharing a part',
      withLists({
        Post: {
          fields: {
            one: partsField({ name: 'one' }, { name: 'shared' }),
            two: partsField({ name: 'two' }, { name: 'shared' }),
          },
        },
      }),
      'Post',
    ],
    [
      'a part column colliding with an auto-timestamp',
      withLists({
        Post: {
          db: { timestamps: true },
          fields: { stamp: partsField({ name: 'stamp' }, { name: 'createdAt' }) },
        },
      }),
      'Post',
    ],
    [
      'a part column colliding with a Synthetic back-relation',
      withLists({
        Post: { fields: { category: relationship({ ref: 'Category' }) } },
        Category: {
          fields: { tag: partsField({ name: 'tag' }, { name: 'from_Post_category' }) },
        },
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
  const scratch = mkdtempSync(path.join(tmpdir(), 'list-members-'))
  afterAll(() => rmSync(scratch, { recursive: true, force: true }))

  function isTypeOnlyImport(node: ts.ImportDeclaration): boolean {
    const clause = node.importClause
    if (clause === undefined) return false
    if (clause.isTypeOnly) return true
    const bindings = clause.namedBindings
    return (
      clause.name === undefined &&
      bindings !== undefined &&
      ts.isNamedImports(bindings) &&
      bindings.elements.length > 0 &&
      bindings.elements.every((element) => element.isTypeOnly)
    )
  }

  function valueSpecifiersOf(file: string): string[] {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.ESNext,
      true,
    )
    const specifiers: string[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        if (!isTypeOnlyImport(node)) specifiers.push(node.moduleSpecifier.text)
      } else if (
        ts.isExportDeclaration(node) &&
        !node.isTypeOnly &&
        node.moduleSpecifier !== undefined &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        specifiers.push(node.moduleSpecifier.text)
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] !== undefined &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        specifiers.push(node.arguments[0].text)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    return specifiers
  }

  function bareImportsOf(entry: string): Set<string> {
    const seen = new Set<string>()
    const bare = new Set<string>()
    const pending = [entry]
    while (pending.length > 0) {
      const file = pending.pop()
      if (file === undefined || seen.has(file)) continue
      seen.add(file)
      for (const specifier of valueSpecifiersOf(file)) {
        if (!specifier.startsWith('.')) {
          bare.add(specifier)
          continue
        }
        const resolved = path.resolve(path.dirname(file), specifier.replace(/\.js$/, '.ts'))
        if (existsSync(resolved)) pending.push(resolved)
      }
    }
    return bare
  }

  it('reads side-effect, double-quoted, re-exported and dynamic imports', () => {
    const file = path.join(scratch, 'probe.ts')
    writeFileSync(
      file,
      [
        "import 'node:fs'",
        'import { a } from "node:path"',
        "export * from 'node:url'",
        "export * as b from 'node:os'",
        "const c = import('node:crypto')",
        "import type { D } from 'node:module'",
        "import { type E } from 'node:util'",
      ].join('\n'),
    )
    expect(valueSpecifiersOf(file).sort()).toEqual(
      ['node:crypto', 'node:fs', 'node:os', 'node:path', 'node:url'].sort(),
    )
  })

  it('reaches no Node builtin through any value import', () => {
    const bare = [...bareImportsOf(path.join(here, 'list-members.ts'))]
    expect(bare.length).toBeGreaterThan(0)
    expect(bare.filter((specifier) => builtins.has(specifier))).toEqual([])
  })
})
