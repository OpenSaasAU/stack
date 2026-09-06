import { describe, expect, it } from 'vitest'
import { deriveDependencyTable, type OpenSaasConfig } from '@opensaas/stack-core'
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

/** The renderer takes the one derived table the CLI computes, so a test derives it the same way. */
function render(config: OpenSaasConfig): string {
  return generateTypes(config, deriveDependencyTable(config))
}

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
  const types = render(config)

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

  it('keys the db surface by each list’s PascalCase list name', () => {
    expect(types).toContain('export interface DB {\n  User: UserList\n  Post: PostList')
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

/**
 * The `needs` type and the runtime dependency-set table are the same rows of
 * one derivation (#1136, ADR-0051). These pin the four places where rendering
 * the declaration verbatim would have said something the table does not.
 */
describe('the needs type reads the derived dependency table', () => {
  it('adds the foreign-key column a declared relation implies', () => {
    // The read is widened to `authorId` as well as `author`, so a type naming
    // only the relation would hide a column the hook is actually handed.
    const types = render({
      db: { provider: 'postgresql' },
      lists: {
        User: { fields: { name: text(), posts: relationship({ ref: 'Post.author', many: true }) } },
        Post: {
          fields: {
            title: text(),
            author: relationship({ ref: 'User.posts' }),
            byline: virtual({
              type: 'string',
              needs: ['author'],
              hooks: { resolveOutput: ({ item }) => `${item.authorId ?? ''}` },
            }),
          },
        },
      },
    })
    expect(types).toContain("needs: {\n      byline: 'authorId' | 'author'\n    }")
  })

  it('names only the relation where the other side owns the foreign key', () => {
    const types = render({
      db: { provider: 'postgresql' },
      lists: {
        User: {
          fields: {
            name: text(),
            posts: relationship({ ref: 'Post.author', many: true }),
            headline: virtual({
              type: 'string',
              needs: ['posts'],
              hooks: { resolveOutput: () => '' },
            }),
          },
        },
        Post: { fields: { title: text(), author: relationship({ ref: 'User.posts' }) } },
      },
    })
    expect(types).toContain("needs: {\n      headline: 'posts'\n    }")
  })

  it('drops a declaration on a field with no resolveOutput hook', () => {
    // Nothing widens a read for it, so the table has no row and neither does
    // the type — a `NeedsItem` for it would describe an item never built.
    // `virtual()` refuses a hookless field, so only a third-party field
    // setting `virtual` itself can reach this.
    const types = render({
      db: { provider: 'postgresql' },
      lists: {
        Post: {
          fields: {
            title: text(),
            summary: { type: 'summary', virtual: true, outputType: 'string', needs: ['title'] },
          },
        },
      },
    })
    expect(types).toContain('needs: Record<never, never>')
    expect(types).not.toContain('PostSummaryNeedsItem')
  })

  it('gives a stored field no needs type, whose hook sees the whole row', () => {
    // `field-visibility.ts` hands a stored field's `resolveOutput` the whole
    // `workingItem`, including the field's own column — which `NeedsRow`'s
    // `Pick` does not name. The table keeps the row for the widening; the
    // type would only reject reads that succeed.
    const types = render({
      db: { provider: 'postgresql' },
      lists: { User: { fields: { name: text(), secret: password() } } },
    })
    expect(types).toContain('needs: Record<never, never>')
    expect(types).not.toContain('UserSecretNeedsItem')
  })

  it('drops an entry naming a field the list does not have', () => {
    const types = render({
      db: { provider: 'postgresql' },
      lists: {
        Post: {
          fields: {
            title: text(),
            summary: virtual({
              type: 'string',
              needs: ['title', 'gone'],
              hooks: { resolveOutput: ({ item }) => `${item.title}` },
            }),
          },
        },
      },
    })
    expect(types).toContain("needs: {\n      summary: 'title'\n    }")
  })

  it('gives a hook that declares nothing an empty set, not no entry', () => {
    // `never` still resolves through `NeedsRow` to the list's system fields,
    // which is exactly what the runtime hands such a hook.
    const types = render({
      db: { provider: 'postgresql' },
      lists: {
        Post: {
          fields: {
            title: text(),
            slug: virtual({ type: 'string', hooks: { resolveOutput: () => '' } }),
          },
        },
      },
    })
    expect(types).toContain('needs: {\n      slug: never\n    }')
    expect(types).toContain('export interface PostSlugNeedsItem')
  })
})

describe('what the generated types refuse to emit', () => {
  it('imports NeedsRow only when a field declares dependencies', () => {
    expect(render(config)).toContain('NeedsRow as Stack$NeedsRow')

    const withoutNeeds = render({
      db: { provider: 'postgresql' },
      lists: { Post: { fields: { title: text() } } },
    })
    // A project compiling `.opensaas/` under `noUnusedLocals` cannot edit
    // generated code to silence an import it never uses.
    expect(withoutNeeds).not.toContain('NeedsRow')
  })

  it('refuses a virtual field with no declared output type', () => {
    expect(() =>
      render({
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
      render({
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
      render({
        db: { provider: 'postgresql' },
        lists: { Context: { fields: { title: text() } } },
      }),
    ).toThrow(/"Context" twice/)
  })

  it('lets a list take the name of a core generic', () => {
    // The imports are aliased out of reach, so `Row` is the app's own list.
    const types = render({
      db: { provider: 'postgresql' },
      lists: { Row: { fields: { title: text() } } },
    })
    expect(types).toContain(
      "export interface Row extends Stack$Row<Stack$Contract, Remainder, 'Row'>",
    )
  })
})
