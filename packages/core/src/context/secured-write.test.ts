import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import pg from 'pg'
import type { AccessControlledDB, Session } from '../access/index.js'
import type { OpenSaasConfig } from '../config/types.js'
import { relationship, text } from '../fields/index.js'
import { createTestContext, ormClientFor, type TestContext } from '../testing/context.js'
import type { StackContext } from '../types/context.js'
import { WriteMatchedNothingError } from '../index.js'
import { getContext } from './index.js'
import { NestedRelationInputError, RelationInputNotLoweredError } from './relationship-input.js'

/**
 * #1152: the write terminals over a real rc.8 collection.
 *
 * Everything here goes in through `context.db` and comes back either through
 * the secured read surface or through the driver, so no assertion depends on
 * the statement the engine built. The database is the in-process one the Test
 * context stands up (ADR-0057).
 */

const BOOT = 120_000

const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }

function schemaConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql', timestamps: true },
    lists: {
      Post: {
        fields: { title: text(), authorId: text() },
        access: { operation: OPEN },
      },
    },
  }
}

/** Rows straight off the driver, so nothing the engine returns can hide one. */
async function storedTitles(url: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    const result = await client.query('select "title" from "public"."Post" order by "title"')
    return result.rows.map((row: { title: string }) => row.title)
  } finally {
    await client.end()
  }
}

describe('the write terminals over a real collection', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(schemaConfig(), { userId: 'u1' })
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    await harness.truncate()
  })

  /**
   * A context over the harness's client at a config of this test's choosing.
   * The schema is the one already applied; only the access rules and hooks vary.
   */
  function contextAt(
    config: OpenSaasConfig,
    session: Session | null,
  ): StackContext<AccessControlledDB> {
    const orm = ormClientFor(harness.data, harness.client.orm)
    return getContext(config, orm, session, undefined, false, undefined, undefined, harness.client)
  }

  test(
    'a created row reads back through the secured read surface',
    async () => {
      const created = await harness.context.db.Post.create({
        data: { title: 'ship it', authorId: 'u1' },
      })

      expect(created).toMatchObject({ title: 'ship it', authorId: 'u1' })

      const read = await harness.context.db.Post.where({ title: 'ship it' }).first()
      expect(read).toMatchObject({ title: 'ship it', authorId: 'u1' })
      expect(read?.id).toBe(created?.id)
      expect(await storedTitles(harness.url)).toEqual(['ship it'])
    },
    BOOT,
  )

  /**
   * The negative control for the round trip above: the same call under a
   * `create` rule that denies. A `create` that short-circuited to `null`
   * whatever the rule said would pass this test and fail the one above, so the
   * pair pins the difference rather than the shape.
   */
  test(
    'a denied create returns null and writes nothing',
    async () => {
      const denied = contextAt(
        {
          ...schemaConfig(),
          lists: {
            Post: {
              fields: { title: text(), authorId: text() },
              access: { operation: { ...OPEN, create: () => false } },
            },
          },
        },
        { userId: 'u1' },
      )

      expect(await denied.db.Post.create({ data: { title: 'ship it' } })).toBeNull()
      expect(await storedTitles(harness.url)).toEqual([])
    },
    BOOT,
  )

  test(
    'update and delete act only on rows the Access Filter admits',
    async () => {
      await harness.context.db.Post.create({ data: { title: 'mine', authorId: 'u1' } })
      await harness.context.db.Post.create({ data: { title: 'theirs', authorId: 'u2' } })

      const mine = await harness.context.db.Post.where({ title: 'mine' }).first()
      const theirs = await harness.context.db.Post.where({ title: 'theirs' }).first()

      const scoped = contextAt(
        {
          ...schemaConfig(),
          lists: {
            Post: {
              fields: { title: text(), authorId: text() },
              access: {
                operation: {
                  query: () => true,
                  create: () => true,
                  update: ({ session }) => ({ authorId: { equals: session?.userId } }),
                  delete: ({ session }) => ({ authorId: { equals: session?.userId } }),
                },
              },
            },
          },
        },
        { userId: 'u1' },
      )

      const updatedMine = await scoped.db.Post.update({
        where: { id: String(mine?.id) },
        data: { title: 'mine, edited' },
      })
      expect(updatedMine).toMatchObject({ title: 'mine, edited' })

      // Same call, same session, a row the filter excludes: denied-or-gone.
      expect(
        await scoped.db.Post.update({
          where: { id: String(theirs?.id) },
          data: { title: 'hijacked' },
        }),
      ).toBeNull()
      expect(await scoped.db.Post.delete({ where: { id: String(theirs?.id) } })).toBeNull()

      expect(await storedTitles(harness.url)).toEqual(['mine, edited', 'theirs'])

      expect(await scoped.db.Post.delete({ where: { id: String(mine?.id) } })).toMatchObject({
        title: 'mine, edited',
      })
      expect(await storedTitles(harness.url)).toEqual(['theirs'])
    },
    BOOT,
  )

  /**
   * Defence in depth for the Access Filter reaching the write STATEMENT, not
   * just the gate. The target read and the filter re-check both pass; a
   * `beforeOperation` hook then moves the row out of the filter from inside the
   * same transaction. Only a write whose own predicate carries the filter can
   * answer `null` here — one scoped by identity alone still matches the row.
   */
  test(
    'a row that leaves the filter mid-transaction is not written',
    async () => {
      const created = await harness.context.db.Post.create({
        data: { title: 'before', authorId: 'u1' },
      })

      const mine = ({ session }: { session: Session | null }) => ({
        authorId: { equals: session?.userId },
      })

      const config: OpenSaasConfig = {
        ...schemaConfig(),
        lists: {
          Post: {
            fields: { title: text(), authorId: text() },
            access: {
              operation: { query: () => true, create: () => true, update: mine, delete: mine },
            },
            hooks: {
              beforeOperation: async (args) => {
                // Only the caller's own update reassigns; the nested one below
                // must not re-enter this hook.
                if (args.operation !== 'update') return
                if (args.resolvedData?.title !== 'after') return
                await args.context.db.Post.update({
                  where: { id: String(created?.id) },
                  data: { authorId: 'u2' },
                })
              },
            },
          },
        },
      }

      const scoped = contextAt(config, { userId: 'u1' })
      expect(
        await scoped.db.Post.update({
          where: { id: String(created?.id) },
          data: { title: 'after' },
        }),
      ).toBeNull()

      expect(await storedTitles(harness.url)).toEqual(['before'])
    },
    BOOT,
  )

  /**
   * The bracket reports what happened, not what was attempted: the write above
   * persisted nothing, so a compensator keyed on `committed` must not run.
   */
  test(
    'a write that persisted nothing reports rolled-back to afterTransaction',
    async () => {
      const created = await harness.context.db.Post.create({ data: { title: 'before' } })

      const settled: string[] = []
      const reasons: unknown[] = []
      const config: OpenSaasConfig = {
        ...schemaConfig(),
        lists: {
          Post: {
            fields: { title: text(), authorId: text() },
            access: { operation: OPEN },
            hooks: {
              beforeOperation: async (args) => {
                if (args.operation !== 'update') return
                await args.context.db.Post.delete({ where: { id: String(created?.id) } })
              },
              afterTransaction: async (args) => {
                settled.push(args.status)
                if (args.status === 'rolled-back') reasons.push(args.error)
              },
            },
          },
        },
      }

      const context = contextAt(config, { userId: 'u1' })
      expect(
        await context.db.Post.update({
          where: { id: String(created?.id) },
          data: { title: 'after' },
        }),
      ).toBeNull()

      // The owner's own bracket first (the update, which wrote nothing), then
      // the joined delete's deferred one (ADR-0028), which did commit.
      expect(settled).toEqual(['rolled-back', 'committed'])
      // The reason reaches the compensator as a named type off the package
      // root, so telling "matched nothing" from a real rollback does not mean
      // matching on `error.name`.
      expect(reasons).toHaveLength(1)
      expect(reasons[0]).toBeInstanceOf(WriteMatchedNothingError)
      expect(await storedTitles(harness.url)).toEqual([])
    },
    BOOT,
  )

  /**
   * `findUnique` beside these terminals rejects a non-unique `where` loudly
   * rather than answering the denied-or-gone `null`; a write selector the
   * engine cannot lower is the same class of caller mistake.
   */
  test(
    'update and delete by anything but `id` are a loud caller-shape error',
    async () => {
      await harness.context.db.Post.create({ data: { title: 'keep', authorId: 'u1' } })

      await expect(
        harness.context.db.Post.update({ where: { authorId: 'u1' }, data: { title: 'moved' } }),
      ).rejects.toThrow(/requires `where: \{ id \}`/)

      await expect(harness.context.db.Post.delete({ where: { authorId: 'u1' } })).rejects.toThrow(
        /requires `where: \{ id \}`/,
      )

      await expect(
        harness.context.db.Post.update({ where: {}, data: { title: 'moved' } }),
      ).rejects.toThrow(/requires `where: \{ id \}`/)

      await expect(
        harness.context.db.Post.update({ where: { id: undefined }, data: { title: 'moved' } }),
      ).rejects.toThrow(/requires `where: \{ id \}`/)

      expect(await storedTitles(harness.url)).toEqual(['keep'])
    },
    BOOT,
  )

  test(
    'the in-transaction and boundary hooks fire once per write, in order',
    async () => {
      const fired: string[] = []
      const record = (name: string) => async (): Promise<void> => {
        fired.push(name)
      }

      const config: OpenSaasConfig = {
        ...schemaConfig(),
        lists: {
          Post: {
            fields: {
              title: text({
                hooks: {
                  resolveInput: ({ resolvedData, fieldKey }) => {
                    fired.push('field:resolveInput')
                    return resolvedData[fieldKey]
                  },
                  beforeOperation: record('field:beforeOperation'),
                  afterOperation: record('field:afterOperation'),
                },
              }),
              authorId: text(),
            },
            access: { operation: OPEN },
            hooks: {
              beforeTransaction: record('list:beforeTransaction'),
              resolveInput: ({ resolvedData }) => {
                fired.push('list:resolveInput')
                return resolvedData
              },
              validate: record('list:validate'),
              beforeOperation: record('list:beforeOperation'),
              afterOperation: record('list:afterOperation'),
              afterTransaction: record('list:afterTransaction'),
            },
          },
        },
      }

      await contextAt(config, { userId: 'u1' }).db.Post.create({ data: { title: 'once' } })

      expect(fired).toEqual([
        'list:beforeTransaction',
        'list:resolveInput',
        'field:resolveInput',
        'list:validate',
        'field:beforeOperation',
        'list:beforeOperation',
        'list:afterOperation',
        'field:afterOperation',
        'list:afterTransaction',
      ])
    },
    BOOT,
  )

  test(
    'a throwing afterOperation rolls an update back',
    async () => {
      const created = await harness.context.db.Post.create({ data: { title: 'before' } })

      const config: OpenSaasConfig = {
        ...schemaConfig(),
        lists: {
          Post: {
            fields: { title: text(), authorId: text() },
            access: { operation: OPEN },
            hooks: {
              afterOperation: async ({ operation }) => {
                if (operation === 'update') throw new Error('the hook rejected the update')
              },
            },
          },
        },
      }

      await expect(
        contextAt(config, { userId: 'u1' }).db.Post.update({
          where: { id: String(created?.id) },
          data: { title: 'after' },
        }),
      ).rejects.toThrow('the hook rejected the update')

      expect(await storedTitles(harness.url)).toEqual(['before'])
    },
    BOOT,
  )
})

describe('a nested write in a payload is refused', () => {
  let harness: TestContext

  const relationConfig = (create: () => boolean): OpenSaasConfig => ({
    db: { provider: 'postgresql', timestamps: true },
    lists: {
      Author: {
        fields: { name: text() },
        access: { operation: OPEN },
      },
      Post: {
        fields: {
          title: text(),
          author: relationship({ ref: 'Author' }),
        },
        access: { operation: { ...OPEN, create } },
      },
    },
  })

  beforeAll(async () => {
    harness = await createTestContext(
      relationConfig(() => true),
      { userId: 'u1' },
    )
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    await harness.truncate()
  })

  const NESTED: Record<string, unknown> = {
    create: { create: { name: 'a' } },
    update: { update: { where: { id: 'a1' }, data: { name: 'a' } } },
    delete: { delete: true },
    connectOrCreate: { connectOrCreate: { where: { id: 'a1' }, create: { name: 'a' } } },
    disconnect: { disconnect: true },
    set: { set: [{ id: 'a1' }] },
    updateMany: { updateMany: { where: {}, data: { name: 'a' } } },
    deleteMany: { deleteMany: {} },
  }

  for (const [kind, payload] of Object.entries(NESTED)) {
    test(
      `nested ${kind} is refused, and nothing is written`,
      async () => {
        await expect(
          harness.context.db.Post.create({ data: { title: 't', author: payload } }),
        ).rejects.toBeInstanceOf(NestedRelationInputError)

        await expect(
          harness.context.db.Post.create({ data: { title: 't', author: payload } }),
        ).rejects.toThrow(new RegExp(`\`${kind}\``))

        expect(await storedTitles(harness.url)).toEqual([])
      },
      BOOT,
    )
  }

  /**
   * `connect` is the one spelling ADR-0050 keeps, and #1153 lowers. Until it
   * does it must not reach the driver as a column value — the error there names
   * neither this list nor this field.
   */
  test('connect is refused by name until #1153, and nothing is written', async () => {
    const payload = { connect: { id: 'a1' } }

    await expect(
      harness.context.db.Post.create({ data: { title: 't', author: payload } }),
    ).rejects.toBeInstanceOf(RelationInputNotLoweredError)

    await expect(
      harness.context.db.Post.create({ data: { title: 't', author: payload } }),
    ).rejects.toThrow(/"Post".+"author".+`connect`/s)

    await expect(
      harness.context.db.Post.create({ data: { title: 't', author: payload } }),
    ).rejects.toThrow(/#1153/)

    expect(await storedTitles(harness.url)).toEqual([])
  })

  /**
   * `{ connect: cond ? { id } : undefined }` names no spelling once the
   * conditional resolves, but an object on a relationship key is not a column
   * value either. It is refused by name rather than reaching the driver, which
   * answers `invalid input syntax for type uuid: "{}"`.
   */
  test('a relation object carrying no spelling is refused, and nothing is written', async () => {
    await expect(
      harness.context.db.Post.create({ data: { title: 't', author: { connect: undefined } } }),
    ).rejects.toBeInstanceOf(RelationInputNotLoweredError)

    await expect(
      harness.context.db.Post.create({ data: { title: 't', author: { connect: undefined } } }),
    ).rejects.toThrow(/"Post".+"author"/s)

    expect(await storedTitles(harness.url)).toEqual([])
  })

  /**
   * The pre-transaction refusal reads the caller's payload, which a hook has
   * not touched yet. A `resolveInput` that assembles relation input — the shape
   * `examples/starter-auth` uses to preset an author — is only visible after
   * the hooks run, so the refusal has to look again.
   */
  test(
    'relation input a resolveInput hook assembles is refused too',
    async () => {
      const config: OpenSaasConfig = {
        ...relationConfig(() => true),
        lists: {
          ...relationConfig(() => true).lists,
          Post: {
            fields: { title: text(), author: relationship({ ref: 'Author' }) },
            access: { operation: OPEN },
            hooks: {
              resolveInput: ({ resolvedData, context }) => ({
                ...resolvedData,
                author: { connect: { id: context.session?.userId } },
              }),
            },
          },
        },
      }

      const orm = ormClientFor(harness.data, harness.client.orm)
      const context = getContext(
        config,
        orm,
        { userId: 'u1' },
        undefined,
        false,
        undefined,
        undefined,
        harness.client,
      )

      await expect(context.db.Post.create({ data: { title: 't' } })).rejects.toBeInstanceOf(
        RelationInputNotLoweredError,
      )
      expect(await storedTitles(harness.url)).toEqual([])
    },
    BOOT,
  )

  /**
   * A synthetic back-relation key is undeclared by design and rides through
   * `filterWritableFields` under sudo, so the refusal is the only thing between
   * it and the driver.
   */
  test(
    'a sudo payload naming a synthetic back-relation is refused too',
    async () => {
      const sudo = harness.context.sudo()

      await expect(
        sudo.db.Author.create({
          data: { name: 'a', from_Post_author: { create: { title: 't' } } },
        }),
      ).rejects.toBeInstanceOf(NestedRelationInputError)

      await expect(
        sudo.db.Author.create({
          data: { name: 'a', from_Post_author: { connect: { id: 'p1' } } },
        }),
      ).rejects.toBeInstanceOf(RelationInputNotLoweredError)

      expect(await storedTitles(harness.url)).toEqual([])
    },
    BOOT,
  )

  test(
    'a caller with no create access gets the silent denial, not the refusal',
    async () => {
      const orm = ormClientFor(harness.data, harness.client.orm)
      const denied = getContext(
        relationConfig(() => false),
        orm,
        { userId: 'u1' },
        undefined,
        false,
        undefined,
        undefined,
        harness.client,
      )

      // The payload is malformed AND the caller is denied. Access wins, so the
      // error never tells a denied caller which fields this list declares
      // (ADR-0031).
      expect(
        await denied.db.Post.create({ data: { title: 't', author: { create: { name: 'a' } } } }),
      ).toBeNull()
    },
    BOOT,
  )
})
