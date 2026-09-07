import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import type { BaseFieldConfig, TypeInfo, VectorDistanceFunction } from '@opensaas/stack-core/extend'
import { checkbox, integer, relationship, text, virtual } from '@opensaas/stack-core/fields'
import {
  CONSUMER_PRELUDE,
  emitTypeFixture,
  type TypeFixture,
} from '../../tests/emit-type-fixture.js'

/**
 * The read subset's terminals and refiners, on the surface a generated project
 * actually gets.
 *
 * `aggregate`, `nearest`, `combine`, `.count()`, `.distinct()`,
 * `.distinctOn()`, `.cursor()` and top-level `offset` shipped on the engine's
 * deliberately-untyped `SecuredQuery` alone (#1150, #1151), so every one of
 * them was `TS2339` from a generated project and both changesets documented an
 * API that did not compile (#1253, QA defect D1 on spec #1123). Everything
 * below therefore drives `./.opensaas/types.ts` rather than core's internals —
 * the same discipline `types-read-select-narrowing.test.ts` established for
 * `.select()`.
 *
 * The two changeset examples are compiled verbatim, because they are the
 * artifact the defect was found in.
 */

/** The vector field RAG's `embedding()` will be (#1128), declared here so the fixture owns no plugin. */
function embedding(
  dimensions: number,
  distanceFunction: VectorDistanceFunction,
): BaseFieldConfig<TypeInfo> {
  return {
    type: 'vector',
    getContractField: (fieldName) => ({
      kind: 'column',
      name: fieldName,
      type: { pack: 'pgvector', type: 'Vector', args: [dimensions] },
      nullable: true,
    }),
    getVectorColumn: (fieldName) => ({ column: fieldName, dimensions, distanceFunction }),
  }
}

const config: OpenSaasConfig = {
  db: {
    provider: 'postgresql',
    timestamps: true,
    extensions: [{ name: 'pgvector', from: '@prisma/orm-extension-pgvector' }],
  },
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
    Article: {
      fields: {
        title: text({ validation: { isRequired: true } }),
        published: checkbox({ defaultValue: false }),
        embedding: embedding(1536, 'cosine'),
      },
    },
    Settings: {
      isSingleton: true,
      fields: { siteName: text({ validation: { isRequired: true } }) },
    },
  },
}

describe('the read subset over the emitted contract', () => {
  let fixture: TypeFixture

  beforeAll(async () => {
    fixture = await emitTypeFixture('read-terminals', config)
  }, 300_000)

  afterAll(() => {
    fixture?.cleanup()
  })

  it('compiles the aggregate example the changeset publishes', { timeout: 300_000 }, () => {
    const output = fixture.check(`${CONSUMER_PRELUDE}
import type { Context } from './.opensaas/types.ts'

declare const context: Context

async function run() {
  const { total } = await context.db.Post.where({ published: { equals: true } }).aggregate(
    (aggregate) => ({ total: aggregate.count() }),
  )

  assertType<Exact<typeof total, number>>()

  // Every key the spec named, and only those.
  const several = await context.db.Post.aggregate((aggregate) => ({
    all: aggregate.count(),
    some: aggregate.count(),
  }))
  assertType<Exact<keyof typeof several, 'all' | 'some'>>()

  // @ts-expect-error count() is the only reducer the surface carries
  await context.db.Post.aggregate((aggregate) => ({ total: aggregate.sum('views') }))
}

void run
`)

    expect(output).toBe('')
  })

  it('compiles the combine example the changeset publishes', { timeout: 300_000 }, () => {
    const output = fixture.check(`${CONSUMER_PRELUDE}
import type { Context } from './.opensaas/types.ts'

declare const context: Context

async function run() {
  const users = await context.db.User.include('posts', (posts) =>
    posts.combine({
      published: posts.where({ published: { equals: true } }).count(),
      total: posts.count(),
    }),
  ).all()
  // each row: { …user, posts: { published: number; total: number } }
  assertType<Exact<(typeof users)[number]['posts']['published'], number>>()
  assertType<Exact<(typeof users)[number]['posts']['total'], number>>()
  assertType<Exact<(typeof users)[number]['name'], string>>()

  // A bare count reads as the number itself.
  const counted = await context.db.User.include('posts', (posts) => posts.count()).all()
  assertType<Exact<(typeof counted)[number]['posts'], number>>()

  // @ts-expect-error the relation was reduced, so its rows are not there
  counted[0].posts.length
}

void run
`)

    expect(output).toBe('')
  })

  it('compiles the nearest example the changeset publishes', { timeout: 300_000 }, () => {
    const output = fixture.check(`${CONSUMER_PRELUDE}
import type { Context } from './.opensaas/types.ts'

declare const context: Context
declare const queryVector: number[]

async function run() {
  const hits = await context.db.Article.where({ published: true }).nearest(
    'embedding',
    queryVector,
    { limit: 5, minScore: 0.8 },
  )

  for (const { item, score } of hits) {
    console.log(item.title, score)
  }

  assertType<Exact<(typeof hits)[number]['score'], number>>()

  // \`item\` honours the projection, exactly as \`all()\`'s row does.
  const projected = await context.db.Article.select('title').nearest('embedding', queryVector)
  assertType<
    Exact<keyof (typeof projected)[number]['item'], 'id' | 'createdAt' | 'updatedAt' | 'title'>
  >()

  // @ts-expect-error \`headline\` is not a column of this list
  await context.db.Article.nearest('headline', queryVector)
}

void run
`)

    expect(output).toBe('')
  })

  it('carries distinct, distinctOn, cursor and offset', { timeout: 300_000 }, () => {
    const output = fixture.check(`${CONSUMER_PRELUDE}
import type { Context } from './.opensaas/types.ts'

declare const context: Context

async function run() {
  const rows = await context.db.Post.orderBy({ title: 'asc' })
    .distinct('title')
    .offset(5)
    .limit(10)
    .all()
  assertType<Exact<(typeof rows)[number]['title'], string>>()

  await context.db.Post.orderBy({ title: 'asc' }).distinctOn('title').all()
  await context.db.Post.orderBy({ title: 'asc' }).cursor({ title: 'The Post' }).all()

  // Paging and projection compose without losing the projection.
  const paged = await context.db.Post.select('title').offset(2).all()
  assertType<Exact<keyof (typeof paged)[number], 'id' | 'createdAt' | 'updatedAt' | 'title'>>()

  // @ts-expect-error a computed field is stored nowhere, so it cannot be a distinct key
  await context.db.Post.distinct('wordCount').all()

  // @ts-expect-error nor a key the list does not have
  await context.db.Post.distinctOn('titel').all()

  // @ts-expect-error a cursor seeks on this list's own columns
  await context.db.Post.cursor({ titel: 'x' }).all()

  // @ts-expect-error a cursor value has the column's own type
  await context.db.Post.cursor({ title: 7 }).all()
}

void run
`)

    expect(output).toBe('')
  })

  /**
   * `populateDbDelegate` wires the composed read in the `else` of
   * `isSingletonList`, so a singleton carries `get` and the CRUD delegate and
   * none of these. The type has to say the same thing, or every one of them
   * type-checks and throws `TypeError: … is not a function`.
   */
  it('leaves the composed read off a singleton list', { timeout: 300_000 }, () => {
    const output = fixture.check(`${CONSUMER_PRELUDE}
import type { Context } from './.opensaas/types.ts'

declare const context: Context
declare const queryVector: number[]

async function run() {
  // What a singleton does carry.
  const settings = await context.db.Settings.get()
  assertType<Exact<NonNullable<typeof settings>['siteName'], string>>()
  await context.db.Settings.findMany()
  await context.db.Settings.count()

  // @ts-expect-error a singleton has no composed read to start
  context.db.Settings.where
  // @ts-expect-error nor a terminal for one
  context.db.Settings.all
  // @ts-expect-error nor the single-row terminal
  context.db.Settings.first
  // @ts-expect-error nor orderBy
  context.db.Settings.orderBy
  // @ts-expect-error nor include
  context.db.Settings.include
  // @ts-expect-error nor select
  context.db.Settings.select
  // @ts-expect-error nor limit
  context.db.Settings.limit
  // @ts-expect-error nor offset
  context.db.Settings.offset
  // @ts-expect-error nor distinct
  context.db.Settings.distinct
  // @ts-expect-error nor distinctOn
  context.db.Settings.distinctOn
  // @ts-expect-error nor cursor
  context.db.Settings.cursor
  // @ts-expect-error nor aggregate
  context.db.Settings.aggregate
  // @ts-expect-error nor nearest
  context.db.Settings.nearest

  // The non-singleton keeps every one of them.
  await context.db.Post.where({ published: { equals: true } }).offset(1).first()
  await context.db.Article.nearest('embedding', queryVector)
}

void run
`)

    expect(output).toBe('')
  })

  it('lets a consumer name the aggregate builder it factors out', { timeout: 300_000 }, () => {
    const output = fixture.check(`${CONSUMER_PRELUDE}
import type { Aggregations, CountReduction, NearestMatch } from '@opensaas/stack-core'
import type { Context } from './.opensaas/types.ts'

declare const context: Context

// Inference covers a builder written inline; a factored-out one needs the
// parameter's type to be importable.
const totals = (aggregate: Aggregations): { total: CountReduction } => ({
  total: aggregate.count(),
})

async function run() {
  const { total } = await context.db.Post.aggregate(totals)
  assertType<Exact<typeof total, number>>()

  const hits = await context.db.Article.nearest('embedding', [])
  assertType<Exact<typeof hits, NearestMatch<(typeof hits)[number]['item']>[]>>()
}

void run
`)

    expect(output).toBe('')
  })

  it('reduces a to-many relation only, and only a where()', { timeout: 300_000 }, () => {
    const output = fixture.check(`${CONSUMER_PRELUDE}
import type { Context } from './.opensaas/types.ts'

declare const context: Context

async function run() {
  // The reduction the engine can honour.
  const ok = await context.db.User.include('posts', (posts) =>
    posts.where({ published: { equals: true } }).count(),
  ).all()
  assertType<Exact<(typeof ok)[number]['posts'], number>>()

  // @ts-expect-error a to-one reads as one row or null, so there is nothing to count
  await context.db.Post.include('author', (author) => author.count()).all()

  // @ts-expect-error nor to combine
  await context.db.Post.include('author', (author) => author.combine({ n: author.count() })).all()

  // @ts-expect-error a count honours where() alone — not a select()
  await context.db.User.include('posts', (posts) => posts.select('title').count()).all()

  // @ts-expect-error nor a limit()
  await context.db.User.include('posts', (posts) => posts.limit(3).count()).all()

  // @ts-expect-error nor an orderBy()
  await context.db.User.include('posts', (posts) => posts.orderBy({ title: 'asc' }).count()).all()

  // Including a to-one as rows is untouched.
  const rows = await context.db.Post.include('author', (author) =>
    author.select('name'),
  ).all()
  assertType<Exact<NonNullable<(typeof rows)[number]['author']>['name'], string>>()
}

void run
`)

    expect(output).toBe('')
  })

  it('searches a vector column and no other', { timeout: 300_000 }, () => {
    const output = fixture.check(`${CONSUMER_PRELUDE}
import type { Context } from './.opensaas/types.ts'

declare const context: Context
declare const queryVector: number[]

async function run() {
  await context.db.Article.nearest('embedding', queryVector)

  // @ts-expect-error "title" is a stored column, but it carries no distance function
  await context.db.Article.nearest('title', queryVector)

  // @ts-expect-error and a list with no vector column has nothing to search
  await context.db.Post.nearest('title', queryVector)
}

void run
`)

    expect(output).toBe('')
  })

  /**
   * Spec #1123 story 6: a method appears only where the engine knows how to
   * scope it. Asserted from the generated surface rather than from the
   * engine's, so widening `ListQuery` shows up here.
   */
  it('leaves groupBy, the *All family, *AndCount and upsert absent', { timeout: 300_000 }, () => {
    const output = fixture.check(`${CONSUMER_PRELUDE}
import type { Context } from './.opensaas/types.ts'

declare const context: Context

async function run() {
  // @ts-expect-error groupBy is not on the surface
  context.db.Post.groupBy
  // @ts-expect-error nor is findManyAll
  context.db.Post.findManyAll
  // @ts-expect-error nor updateManyAll
  context.db.Post.updateManyAll
  // @ts-expect-error nor deleteManyAll
  context.db.Post.deleteManyAll
  // @ts-expect-error nor findManyAndCount
  context.db.Post.findManyAndCount
  // @ts-expect-error nor upsert
  context.db.Post.upsert
  // @ts-expect-error a composed read carries no aggregate the engine cannot scope
  context.db.Post.where({ published: true }).groupBy
  // @ts-expect-error a refinement has no terminal of its own
  context.db.User.include('posts', (posts) => posts.all())
}

void run
`)

    expect(output).toBe('')
  })
})
