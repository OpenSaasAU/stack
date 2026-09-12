import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { checkbox, integer, relationship, text, virtual } from '@opensaas/stack-core/fields'
import {
  CONSUMER_PRELUDE,
  emitTypeFixture,
  type TypeFixture,
} from '../../tests/emit-type-fixture.js'

/**
 * `.select()` on the surface a generated project actually gets.
 *
 * The engine's own view of a composed read (`SecuredQuery`) is untyped by
 * design, so a member added there alone is a feature that is tested and not
 * delivered: an application types `context.db.<List>` as
 * `SecuredList<Contract, Remainder, K>` and reaches `ListQuery` instead
 * (#1249 review). Everything below therefore drives `./.opensaas/types.ts`
 * rather than core's internals.
 *
 * What is asserted:
 *  - `.select()` exists on the query and on a refinement, and its keys are
 *    the list's own — a misspelling and a relation are both compile errors;
 *  - a projected read's row type is exactly the named keys plus the list's
 *    system fields, so an unselected column is absent from the TYPE and not
 *    merely from the value;
 *  - the columns the engine widens the query by — a computed field's `needs`
 *    — are absent from the type, which is what makes widen-and-strip visible
 *    to the compiler;
 *  - `select()` and `include()` compose, and a refinement's own projection
 *    narrows the included rows;
 *  - the example `docs/content/concepts/queries.md` publishes compiles.
 */

const config: OpenSaasConfig = {
  db: { provider: 'postgresql', timestamps: true },
  lists: {
    User: {
      fields: {
        name: text({ validation: { isRequired: true } }),
        posts: relationship({ ref: 'Post.author', many: true }),
      },
    },
    Post: {
      fields: {
        title: text({ validation: { isRequired: true } }),
        excerpt: text(),
        body: text(),
        views: integer(),
        published: checkbox({ defaultValue: false }),
        author: relationship({ ref: 'User.posts' }),
        wordCount: virtual({
          type: 'number',
          needs: ['body'],
          hooks: { resolveOutput: ({ item }) => String(item.body ?? '').split(/\s+/).length },
        }),
      },
    },
  },
}

describe('read-path select narrowing over the emitted contract', () => {
  let fixture: TypeFixture

  beforeAll(async () => {
    fixture = await emitTypeFixture('read-select-narrowing', config)
  }, 300_000)

  afterAll(() => {
    fixture?.cleanup()
  })

  it('narrows the terminal to exactly what was selected', { timeout: 300_000 }, () => {
    const output = fixture.check(`${CONSUMER_PRELUDE}
import type { Context } from './.opensaas/types.ts'

declare const context: Context

async function run() {
  const rows = await context.db.Post.select('title', 'excerpt').all()
  const row = rows[0]

  // Exactly the named keys, plus the list's system fields.
  assertType<Exact<keyof typeof row, 'id' | 'createdAt' | 'updatedAt' | 'title' | 'excerpt'>>()
  assertType<Exact<(typeof row)['title'], string>>()

  // @ts-expect-error \`body\` was not selected, so it is not on the row
  row.body

  // @ts-expect-error \`views\` was not selected either
  row.views

  // \`first()\` narrows the same way, and still admits the silent denial.
  const one = await context.db.Post.select('title').first()
  if (one !== null) {
    assertType<Exact<keyof typeof one, 'id' | 'createdAt' | 'updatedAt' | 'title'>>()
  }
}

void run
`)

    expect(output).toBe('')
  })

  it('excludes the widened-but-stripped columns from the type', { timeout: 300_000 }, () => {
    const output = fixture.check(`${CONSUMER_PRELUDE}
import type { Context } from './.opensaas/types.ts'

declare const context: Context

async function run() {
  // \`wordCount\` declares \`needs: ['body']\`. The engine reads \`body\`, computes
  // the field and strips \`body\` back out — so it is absent from the type too.
  const rows = await context.db.Post.select('wordCount').all()
  const row = rows[0]

  assertType<Exact<keyof typeof row, 'id' | 'createdAt' | 'updatedAt' | 'wordCount'>>()
  assertType<Exact<(typeof row)['wordCount'], number>>()

  // @ts-expect-error the declared dependency is the engine's, not the caller's
  row.body
}

void run
`)

    expect(output).toBe('')
  })

  it('refuses a key the list does not have, and a relation', { timeout: 300_000 }, () => {
    const output = fixture.check(`${CONSUMER_PRELUDE}
import type { Context } from './.opensaas/types.ts'

declare const context: Context

async function run() {
  // @ts-expect-error \`titel\` is not a field of this list
  await context.db.Post.select('titel').all()

  // @ts-expect-error a relation is reached with include(), not select()
  await context.db.Post.select('author').all()

  // @ts-expect-error the same rule inside a refinement
  await context.db.User.include('posts', (posts) => posts.select('autor')).all()
}

void run
`)

    expect(output).toBe('')
  })

  it('composes with include, at every level', { timeout: 300_000 }, () => {
    const output = fixture.check(`${CONSUMER_PRELUDE}
import type { Context } from './.opensaas/types.ts'

declare const context: Context

async function run() {
  const rows = await context.db.Post.select('title')
    .include('author', (author) => author.select('name'))
    .all()
  const row = rows[0]

  assertType<
    Exact<keyof typeof row, 'id' | 'createdAt' | 'updatedAt' | 'title' | 'author'>
  >()

  const author = row.author
  if (author !== null) {
    assertType<Exact<keyof typeof author, 'id' | 'createdAt' | 'updatedAt' | 'name'>>()
  }

  // An include with no projection of its own keeps the related row whole.
  const whole = await context.db.Post.select('title').include('author').all()
  const wholeAuthor = whole[0].author
  if (wholeAuthor !== null) {
    assertType<Exact<(typeof wholeAuthor)['name'], string>>()
  }
}

void run
`)

    expect(output).toBe('')
  })

  /**
   * The published example, verbatim. It did not compile when `.select()` was
   * added to the engine's view alone, and nothing in the suite caught that —
   * which is the whole reason this file exists.
   */
  it('compiles the example the docs publish', { timeout: 300_000 }, () => {
    const output = fixture.check(`${CONSUMER_PRELUDE}
import type { Context } from './.opensaas/types.ts'

declare const context: Context

async function run() {
  const summaries = await context.db.Post.where({ published: { equals: true } })
    .orderBy({ createdAt: 'desc' })
    .select('title', 'excerpt')
    .all()

  // …and the type it yields is the projection, not the whole row.
  assertType<
    Exact<keyof (typeof summaries)[number], 'id' | 'createdAt' | 'updatedAt' | 'title' | 'excerpt'>
  >()
}

void run
`)

    expect(output).toBe('')
  })
})
