import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { SqlOrmPlan } from '@prisma/orm-postgres/relational-core'
import type { OpenSaasConfig } from './config/types.js'
import { checkbox, relationship, text } from './fields/index.js'
import { UnmarkedQueryError, withOrigin } from './origin.js'
import { createTestDatabase, type TestDatabase } from './testing/context.js'
import { createPlanRecorder, type PlanRecorder, type RecordedPlan } from './testing/plans.js'
import {
  createUnsafeSurface,
  createUnsafeTransactionSurface,
  unavailableUnsafeSurface,
  UnsafeSurfaceUnavailableError,
  type UnsafeSurface,
  type UnsafeTransactionScope,
} from './unsafe.js'

const BOOT = 120_000

const blogConfig: OpenSaasConfig = {
  db: { provider: 'postgresql', timestamps: true },
  lists: {
    User: {
      fields: {
        name: text({ validation: { isRequired: true } }),
        email: text({ validation: { isRequired: true }, isIndexed: 'unique' }),
        posts: relationship({ ref: 'Post.author', many: true }),
      },
    },
    Post: {
      fields: {
        title: text({ validation: { isRequired: true } }),
        published: checkbox({ defaultValue: false }),
        author: relationship({ ref: 'User.posts' }),
      },
    },
  },
}

type Bag = Record<string, unknown>
type RawTag = (strings: TemplateStringsArray, ...params: unknown[]) => unknown

function isBag(value: unknown): value is Bag {
  return typeof value === 'object' && value !== null
}

/**
 * Prisma's `orm`, `sql` and namespace objects are Proxies with a `get` trap
 * and no `has` trap, so `key in namespace` reports false for a collection that
 * is right there. Every reach below goes through `Reflect.get` and checks the
 * result, the same step the harness performs for the engine.
 */
function at(container: unknown, key: string): Bag {
  const value =
    container === null || (typeof container !== 'object' && typeof container !== 'function')
      ? undefined
      : Reflect.get(container, key)
  if (!isBag(value)) throw new Error(`no "${key}" on the reached value`)
  return value
}

function call(target: Bag, name: string, ...args: unknown[]): unknown {
  const method = target[name]
  if (typeof method !== 'function') throw new Error(`no method "${name}"`)
  return Reflect.apply(method, target, args)
}

function chain(target: Bag, name: string, ...args: unknown[]): Bag {
  const result = call(target, name, ...args)
  if (!isBag(result)) throw new Error(`"${name}" returned no chainable value`)
  return result
}

function asBag(value: unknown): Bag {
  if (!isBag(value)) throw new Error('expected an object')
  return value
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof Reflect.get(value, Symbol.asyncIterator) === 'function'
  )
}

function asAsyncIterable(value: unknown): AsyncIterable<unknown> {
  if (!isAsyncIterable(value)) throw new Error('expected an async iterable')
  return value
}

function isPlan(value: unknown): value is SqlOrmPlan<Bag> {
  return isBag(value) && isBag(value.meta)
}

function plan(value: unknown): SqlOrmPlan<Bag> {
  if (!isPlan(value)) throw new Error('not a built plan')
  return value
}

function isRawTag(value: unknown): value is RawTag {
  return typeof value === 'function'
}

function rawTag(lane: object): RawTag {
  const tag = Reflect.get(lane, 'sql')
  if (!isRawTag(tag)) throw new Error('the raw lane exposes no tag')
  return tag
}

function model(surface: UnsafeSurface, name: string): Bag {
  return at(at(surface.orm, 'public'), name)
}

function origins(recorder: PlanRecorder): (string | undefined)[] {
  return recorder.plans.map((recorded: RecordedPlan) => recorded.origin)
}

async function drain(result: AsyncIterable<unknown>): Promise<unknown[]> {
  const rows: unknown[] = []
  for await (const row of result) rows.push(row)
  return rows
}

describe('the Unsafe surface', () => {
  let database: TestDatabase
  let recorder: PlanRecorder
  let unsafe: UnsafeSurface

  beforeAll(async () => {
    recorder = createPlanRecorder()
    database = await createTestDatabase(blogConfig, { middleware: [recorder.middleware] })
    unsafe = createUnsafeSurface(database.client)
  }, BOOT)

  afterAll(async () => {
    await database?.close()
  })

  beforeEach(async () => {
    await database.truncate()
    recorder.clear()
  })

  async function author(): Promise<string> {
    const created = await call(model(unsafe, 'User'), 'create', {
      name: 'Ada',
      email: `ada-${Math.random()}@example.test`,
    })
    if (!isBag(created) || typeof created.id !== 'string') throw new Error('no user')
    recorder.clear()
    return created.id
  }

  async function post(authorId: string): Promise<string> {
    const created = await call(model(unsafe, 'Post'), 'create', {
      title: 'first',
      published: false,
      authorId,
    })
    if (!isBag(created) || typeof created.id !== 'string') throw new Error('no post')
    recorder.clear()
    return created.id
  }

  describe('every statement shape the spike measured executes marked', () => {
    test(
      'single-statement reads through the proxy',
      async () => {
        const id = await author()
        await post(id)

        recorder.clear()
        await drain(
          asAsyncIterable(call(chain(model(unsafe, 'Post'), 'where', { authorId: id }), 'all')),
        )
        expect(origins(recorder)).toEqual(['unsafe'])

        recorder.clear()
        await drain(asAsyncIterable(call(chain(model(unsafe, 'User'), 'include', 'posts'), 'all')))
        expect(origins(recorder)).toEqual(['unsafe'])

        recorder.clear()
        await call(chain(model(unsafe, 'Post'), 'where', { authorId: id }), 'first')
        expect(origins(recorder)).toEqual(['unsafe'])

        recorder.clear()
        await call(model(unsafe, 'Post'), 'aggregate', (aggregate: unknown) => ({
          n: call(asBag(aggregate), 'count'),
        }))
        expect(origins(recorder)).toEqual(['unsafe'])
      },
      BOOT,
    )

    test(
      'single-statement creates through the proxy',
      async () => {
        await call(model(unsafe, 'User'), 'create', { name: 'Grace', email: 'grace@example.test' })
        expect(origins(recorder)).toEqual(['unsafe'])
      },
      BOOT,
    )

    test(
      'a one-row update and a one-row delete are two statements each, both marked',
      async () => {
        const id = await author()
        const postId = await post(id)

        recorder.clear()
        await call(chain(model(unsafe, 'Post'), 'where', { id: postId }), 'update', {
          title: 'renamed',
        })
        expect(origins(recorder)).toEqual(['unsafe', 'unsafe'])

        recorder.clear()
        await call(chain(model(unsafe, 'Post'), 'where', { id: postId }), 'delete')
        expect(origins(recorder)).toEqual(['unsafe', 'unsafe'])
      },
      BOOT,
    )

    test(
      'updateAll and a deleteAll with an include are marked',
      async () => {
        const id = await author()
        const postId = await post(id)

        recorder.clear()
        await call(chain(model(unsafe, 'Post'), 'where', { authorId: id }), 'updateAll', {
          published: true,
        })
        expect(new Set(origins(recorder))).toEqual(new Set(['unsafe']))

        recorder.clear()
        await call(
          chain(chain(model(unsafe, 'Post'), 'where', { id: postId }), 'include', 'author'),
          'deleteAll',
        )
        expect(new Set(origins(recorder))).toEqual(new Set(['unsafe']))
        expect(recorder.plans.length).toBeGreaterThanOrEqual(2)
      },
      BOOT,
    )

    test(
      'a nested create and a nested connect are three statements each, all marked',
      async () => {
        await call(model(unsafe, 'User'), 'create', {
          name: 'Nested',
          email: 'nested@example.test',
          posts: (posts: unknown) => call(asBag(posts), 'create', [{ title: 'child' }]),
        })
        expect(origins(recorder)).toEqual(['unsafe', 'unsafe', 'unsafe'])

        const id = await author()
        recorder.clear()
        await call(model(unsafe, 'Post'), 'create', {
          title: 'connected',
          published: false,
          author: (relation: unknown) => call(asBag(relation), 'connect', { id }),
        })
        expect(origins(recorder)).toEqual(['unsafe', 'unsafe', 'unsafe'])
      },
      BOOT,
    )

    test(
      'two terminals in one transaction are marked by the transaction-bound surface',
      async () => {
        const id = await author()
        const postId = await post(id)

        recorder.clear()
        await database.client.transaction(async (tx: UnsafeTransactionScope) => {
          const bound = createUnsafeTransactionSurface(database.client, tx)
          await call(chain(model(bound, 'Post'), 'where', { id: postId }), 'update', {
            title: 'in-transaction',
          })
          await call(chain(model(bound, 'Post'), 'where', { id: postId }), 'first')
        })

        expect(recorder.plans.length).toBe(3)
        expect(new Set(origins(recorder))).toEqual(new Set(['unsafe']))
      },
      BOOT,
    )

    test(
      'a DSL plan and a raw plan run marked through the executors',
      async () => {
        const id = await author()
        await post(id)
        recorder.clear()

        const dsl = plan(call(chain(at(at(unsafe.sql, 'public'), 'Post'), 'select', 'id'), 'build'))
        await drain(unsafe.query(dsl))
        expect(origins(recorder)).toEqual(['unsafe'])
        expect(recorder.plans[0]?.meta.lane).toBe('dsl')

        recorder.clear()
        const raw = plan(
          call(
            chain(
              asBag(rawTag(unsafe.raw)`UPDATE "public"."Post" SET "title" = "title"`),
              'affectedCount',
            ),
            'build',
          ),
        )
        const stats = await unsafe.execute(raw)
        expect(origins(recorder)).toEqual(['unsafe'])
        expect(recorder.plans[0]?.meta.lane).toBe('raw')
        expect(stats).toBeDefined()
      },
      BOOT,
    )

    test(
      'a streaming read is marked wherever it is consumed',
      async () => {
        const id = await author()
        await post(id)
        recorder.clear()

        const rows = await drain(asAsyncIterable(call(model(unsafe, 'Post'), 'all')))
        expect(rows.length).toBe(1)
        expect(origins(recorder)).toEqual(['unsafe'])
      },
      BOOT,
    )
  })

  describe('what is refused, and what is not', () => {
    test(
      'a foreign query — the client reached directly — throws',
      async () => {
        const foreign = at(at(database.client.orm, 'public'), 'User')
        await expect(drain(asAsyncIterable(call(foreign, 'all')))).rejects.toBeInstanceOf(
          UnmarkedQueryError,
        )
      },
      BOOT,
    )

    test(
      'a plan built inside a scope and run outside it throws',
      async () => {
        const built = await withOrigin('unsafe', async () =>
          plan(call(chain(at(at(unsafe.sql, 'public'), 'Post'), 'select', 'id'), 'build')),
        )
        await expect(drain(database.client.runtime().query(built))).rejects.toBeInstanceOf(
          UnmarkedQueryError,
        )
      },
      BOOT,
    )

    test(
      'a lazy result held across an await is still covered',
      async () => {
        const id = await author()
        await post(id)
        recorder.clear()

        const held = unsafe.query(
          plan(call(chain(at(at(unsafe.sql, 'public'), 'Post'), 'select', 'id'), 'build')),
        )
        await new Promise((resolve) => setTimeout(resolve, 5))
        expect(recorder.plans).toEqual([])

        const rows = await held
        expect(rows.length).toBe(1)
        expect(origins(recorder)).toEqual(['unsafe'])
      },
      BOOT,
    )

    test(
      'interleaved engine, unsafe and foreign calls see exactly their own origin',
      async () => {
        const id = await author()
        await post(id)
        recorder.clear()

        const rawPlan = (): SqlOrmPlan<Bag> =>
          plan(
            call(
              chain(
                asBag(rawTag(database.client.raw)`UPDATE "public"."Post" SET "title" = "title"`),
                'affectedCount',
              ),
              'build',
            ),
          )
        const dslPlan = (): SqlOrmPlan<Bag> =>
          plan(call(chain(at(at(unsafe.sql, 'public'), 'Post'), 'select', 'id'), 'build'))

        const engineCall = (): Promise<unknown> =>
          withOrigin('engine', () => database.client.runtime().execute(rawPlan()))
        const unsafeCall = (): Promise<unknown[]> => drain(unsafe.query(dslPlan()))
        const foreignCall = (): Promise<unknown> =>
          drain(asAsyncIterable(call(at(at(database.client.orm, 'public'), 'Post'), 'all')))

        const settled = await Promise.allSettled(
          Array.from({ length: 30 }, (_, index) =>
            index % 3 === 0 ? engineCall() : index % 3 === 1 ? unsafeCall() : foreignCall(),
          ),
        )

        const foreign = settled.filter((_, index) => index % 3 === 2)
        expect(foreign.every((outcome) => outcome.status === 'rejected')).toBe(true)
        expect(
          settled.filter((_, index) => index % 3 !== 2).every((o) => o.status === 'fulfilled'),
        ).toBe(true)

        const byLane = new Map<string, Set<string | undefined>>()
        for (const recorded of recorder.plans) {
          const seen = byLane.get(recorded.lane) ?? new Set()
          seen.add(recorded.origin)
          byLane.set(recorded.lane, seen)
        }
        expect(byLane.get('raw')).toEqual(new Set(['engine']))
        expect(byLane.get('dsl')).toEqual(new Set(['unsafe']))
        expect(byLane.has('orm')).toBe(false)
      },
      BOOT,
    )

    test(
      'errors are raw driver errors, not the stack-normalised ones',
      async () => {
        const clash = (target: Bag, name: string): Promise<unknown> =>
          Promise.resolve(call(target, 'create', { name, email: 'clash@example.test' }))

        await clash(model(unsafe, 'User'), 'One')

        const throughSurface = await clash(model(unsafe, 'User'), 'Two').catch(
          (error: unknown) => error,
        )
        const throughClient = await withOrigin('unsafe', () =>
          clash(at(at(database.client.orm, 'public'), 'User'), 'Three'),
        ).catch((error: unknown) => error)

        expect(throughSurface).toBeInstanceOf(Error)
        expect(throughClient).toBeInstanceOf(Error)
        expect(Object.getPrototypeOf(throughSurface)).toBe(Object.getPrototypeOf(throughClient))
      },
      BOOT,
    )
  })

  describe('the context carries the surface', () => {
    test(
      'context.unsafe marks its own queries',
      async () => {
        await call(model(database.context().unsafe, 'User'), 'create', {
          name: 'Via context',
          email: 'via-context@example.test',
        })
        expect(origins(recorder)).toEqual(['unsafe'])
      },
      BOOT,
    )

    test(
      'the transaction context carries a transaction-bound surface',
      async () => {
        const id = await author()
        const postId = await post(id)
        recorder.clear()

        await database.context().transaction(async (tx) => {
          await call(chain(model(tx.unsafe, 'Post'), 'where', { id: postId }), 'update', {
            title: 'bound',
          })
          await call(chain(model(tx.unsafe, 'Post'), 'where', { id: postId }), 'first')
        })

        expect(recorder.plans.length).toBe(3)
        expect(new Set(origins(recorder))).toEqual(new Set(['unsafe']))
      },
      BOOT,
    )
  })

  describe('the bare client is not reachable', () => {
    test('prepare and runtime are absent from the runtime value', () => {
      expect(Object.keys(unsafe).sort()).toEqual(['execute', 'orm', 'query', 'raw', 'sql'])
      expect(Reflect.get(unsafe, 'prepare')).toBeUndefined()
      expect(Reflect.get(unsafe, 'runtime')).toBeUndefined()
      expect(Reflect.get(unsafe, 'transaction')).toBeUndefined()
      expect(Reflect.get(unsafe, 'connect')).toBeUndefined()
      expect(Reflect.get(unsafe, 'close')).toBeUndefined()
    })

    test('prepare and runtime are absent from the type', () => {
      // @ts-expect-error the surface exposes no `prepare`
      expect(unsafe.prepare).toBeUndefined()
      // @ts-expect-error the surface exposes no `runtime`
      expect(unsafe.runtime).toBeUndefined()
    })
  })
})

describe('a context built without a client', () => {
  test('refuses every member of the surface by name', () => {
    const surface = unavailableUnsafeSurface()
    expect(() => surface.sql).toThrow(UnsafeSurfaceUnavailableError)
    expect(() => surface.raw).toThrow(UnsafeSurfaceUnavailableError)
    expect(() => surface.orm).toThrow(UnsafeSurfaceUnavailableError)
    expect(() => surface.execute(plan({ meta: { lane: 'raw' } }))).toThrow(/context\.unsafe/)
    expect(() => surface.query(plan({ meta: { lane: 'raw' } }))).toThrow(/context\.unsafe/)
  })
})
