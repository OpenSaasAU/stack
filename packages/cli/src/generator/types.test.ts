import { describe, expect, it } from 'vitest'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import {
  calendarDay,
  checkbox,
  integer,
  password,
  relationship,
  text,
  virtual,
} from '@opensaas/stack-core/fields'
import { generateTypes } from './types.js'

/**
 * `types.ts` authors the contract remainder and nothing else, so that is what
 * these assert. What the remainder MEANS — every scalar type, nullability,
 * relation arity, required-on-create rule and include narrowing — is core's
 * generics over the emitted contract, and is proved by compiling the bundle
 * against a real `contract.d.ts` in `types-large-schema.test.ts` and
 * `types-write-narrowing.test.ts` rather than by matching strings here.
 */

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    User: {
      fields: {
        name: text({ validation: { isRequired: true } }),
        secret: password(),
        age: integer(),
        active: checkbox({ defaultValue: true }),
        posts: relationship({ ref: 'Post.author', many: true }),
        displayName: virtual({
          type: 'string',
          needs: ['name'],
          hooks: { resolveOutput: ({ item }) => `${item.name}` },
        }),
      },
    },
    Post: {
      fields: {
        title: text(),
        day: calendarDay(),
        author: relationship({ ref: 'User.posts' }),
      },
    },
    Settings: {
      isSingleton: true,
      fields: { siteName: text() },
    },
  },
}

describe('the generated types file', () => {
  const types = generateTypes(config)

  it('keys every shape off the emitted contract', () => {
    expect(types).toContain(
      "import type { Contract as Stack$Contract } from '../prisma/contract.d.js'",
    )
    expect(types).toContain("} from '@opensaas/stack-core'")
    expect(types).toContain(
      "import type { PluginServices as Stack$PluginServices } from './plugin-types.ts'",
    )
  })

  it('names a virtual field in `computed`, where the contract has no column', () => {
    expect(types).toContain('computed: {\n      displayName: string\n    }')
  })

  it('names a field whose read face differs from its codec in `output`', () => {
    expect(types).toContain(
      "output: {\n      secret: import('@opensaas/stack-core/internal').HashedPassword\n    }",
    )
  })

  it('names a field whose write face differs from its codec in `input`', () => {
    expect(types).toContain('input: {\n      day: string\n    }')
  })

  it('emits each computed field’s declared dependency set as a type', () => {
    expect(types).toContain("needs: {\n      displayName: 'name'\n    }")
  })

  it('marks a singleton list, which the contract cannot see', () => {
    expect(types).toContain('singleton: true')
    // …and only the singleton.
    expect(types.match(/singleton: true/g)).toHaveLength(1)
  })

  it('leaves an entry the config says nothing about empty', () => {
    expect(types).toContain(
      [
        '  Settings: {',
        '    computed: Record<never, never>',
        '    output: Record<never, never>',
        '    input: Record<never, never>',
        '    needs: Record<never, never>',
      ].join('\n'),
    )
  })

  it('keeps the app-facing names, as named interfaces (ADR-0032)', () => {
    for (const name of ['User', 'Post', 'Settings']) {
      expect(types).toContain(
        `export interface ${name} extends Stack$Row<Stack$Contract, Remainder, '${name}'>`,
      )
      expect(types).toContain(
        `export interface ${name}CreateInput extends Stack$CreateInput<Stack$Contract, Remainder, '${name}'>`,
      )
      expect(types).toContain(
        `export interface ${name}UpdateInput extends Stack$UpdateInput<Stack$Contract, Remainder, '${name}'>`,
      )
      expect(types).toContain(
        `export interface ${name}List extends Stack$SecuredList<Stack$Contract, Remainder, '${name}'>`,
      )
    }
    expect(types).toContain('export interface Context<TSession extends Stack$Session')
    expect(types).toContain('export interface BaseContext<TSession extends Stack$Session')
    expect(types).toContain('export interface TransactionContext<TSession extends Stack$Session')
  })

  it('keys the db surface by each list’s camelCase db key', () => {
    expect(types).toContain('export interface DB {\n  user: UserList\n  post: PostList')
  })

  it('writes no per-list args, payload, select, include or where type', () => {
    for (const deleted of [
      'GetPayload',
      'FindManyArgs',
      'FindUniqueArgs',
      'CreateArgs',
      'UpdateArgs',
      'DeleteArgs',
      'DefaultArgs',
      'WhereInput',
      'Select',
      'Include',
      'VirtualFields',
      'TransformedFields',
      'Crud',
      'CustomDB',
      'StripVirtualFromArgs',
      'OpensaasUnnarrowed',
      'OpensaasPayload',
    ]) {
      expect(types).not.toContain(deleted)
    }
  })

  it('derives nothing the contract already carries', () => {
    // No scalar type, nullability or relation arity is written here: the only
    // types in the file come from the remainder's own overrides.
    expect(types).not.toContain('id: string')
    expect(types).not.toContain('title: string')
    expect(types).not.toContain('age: number | null')
    expect(types).not.toContain('posts?:')
  })
})

describe('what the generated types refuse to emit', () => {
  it('imports NeedsRow only when a field declares dependencies', () => {
    expect(generateTypes(config)).toContain('NeedsRow as Stack$NeedsRow')

    const withoutNeeds = generateTypes({
      db: { provider: 'postgresql' },
      lists: { Post: { fields: { title: text() } } },
    })
    // A project compiling `.opensaas/` under `noUnusedLocals` cannot edit
    // generated code to silence an import it never uses.
    expect(withoutNeeds).not.toContain('NeedsRow')
  })

  it('refuses a virtual field with no declared output type', () => {
    expect(() =>
      generateTypes({
        db: { provider: 'postgresql' },
        lists: {
          Post: {
            fields: {
              title: text(),
              // A third-party field can set `virtual` without going through
              // `virtual()`, which is the only way `outputType` goes missing.
              summary: { type: 'summary', virtual: true },
            },
          },
        },
      }),
    ).toThrow(/List "Post", field "summary".*outputType/s)
  })

  it('refuses two lists whose generated names collide', () => {
    expect(() =>
      generateTypes({
        db: { provider: 'postgresql' },
        lists: {
          Post: { fields: { title: text() } },
          PostList: { fields: { title: text() } },
        },
      }),
    ).toThrow(/"PostList" twice: list "Post", and list "PostList"/)
  })

  it('refuses a list that collides with the bundle’s own names', () => {
    expect(() =>
      generateTypes({
        db: { provider: 'postgresql' },
        lists: { Context: { fields: { title: text() } } },
      }),
    ).toThrow(/"Context" twice/)
  })

  it('lets a list take the name of a core generic', () => {
    // The imports are aliased out of reach, so `Row` is the app's own list.
    const types = generateTypes({
      db: { provider: 'postgresql' },
      lists: { Row: { fields: { title: text() } } },
    })
    expect(types).toContain(
      "export interface Row extends Stack$Row<Stack$Contract, Remainder, 'Row'>",
    )
  })
})
