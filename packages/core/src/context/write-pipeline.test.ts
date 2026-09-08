import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import pg from 'pg'
import type { AccessControl, AccessControlledDB, Session } from '../access/index.js'
import { InvalidCreateAccessResultError } from '../access/errors.js'
import type { OpenSaasConfig } from '../config/types.js'
import { text } from '../fields/index.js'
import { ValidationError } from '../hooks/index.js'
import { createTestContext, ormClientFor, type TestContext } from '../testing/context.js'
import type { StackContext } from '../types/context.js'
import { getContext } from './index.js'

/**
 * The Write Pipeline's phase order, its short-circuits and what `sudo` skips,
 * asserted through `context.db` against a real database (ADR-0057).
 *
 * The DB's position in the order is observed the only way that cannot drift
 * from the pipeline: a hook reads through its own `context.db`, which the
 * pipeline has rebound to the write's transaction, so `beforeOperation` sees
 * the row absent and `afterOperation` sees it present.
 */

const BOOT = 120_000

const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }

/** A well-formed id the identity column accepts and no row carries. */
const ABSENT_ID = '00000000-0000-4000-8000-000000000000'

function schemaConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql', timestamps: true },
    lists: {
      Post: {
        fields: {
          title: text({ validation: { isRequired: true } }),
          authorId: text(),
          secret: text(),
        },
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

describe('Write Pipeline', () => {
  let harness: TestContext
  let events: string[]

  beforeAll(async () => {
    harness = await createTestContext(schemaConfig(), { userId: 'u1' })
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    events = []
    await harness.truncate()
  })

  function contextAt(
    config: OpenSaasConfig,
    session: Session | null,
  ): StackContext<AccessControlledDB> {
    const orm = ormClientFor(harness.data, harness.client.orm)
    return getContext(config, orm, session, undefined, false, undefined, undefined, harness.client)
  }

  /**
   * The schema config with a spy on every hook phase, list-level and
   * field-level. `access` and the field's own rules are what each test varies.
   */
  function spiedConfig(options?: {
    operation?: Partial<Record<'create' | 'update' | 'delete', AccessControl>>
    secretCreate?: () => boolean
  }): OpenSaasConfig {
    return {
      db: { provider: 'postgresql', timestamps: true },
      lists: {
        Post: {
          fields: {
            title: text({
              validation: { isRequired: true },
              hooks: {
                resolveInput: ({ resolvedData, fieldKey }) => {
                  events.push('field:resolveInput')
                  return resolvedData[fieldKey]
                },
                validate: () => {
                  events.push('field:validate')
                },
                beforeOperation: () => {
                  events.push('field:beforeOperation')
                },
                afterOperation: () => {
                  events.push('field:afterOperation')
                },
              },
            }),
            authorId: text(),
            secret: text(
              options?.secretCreate ? { access: { create: options.secretCreate } } : undefined,
            ),
          },
          access: {
            operation: {
              query: () => true,
              create: options?.operation?.create ?? (() => true),
              update: options?.operation?.update ?? (() => true),
              delete: options?.operation?.delete ?? (() => true),
            },
          },
          hooks: {
            resolveInput: ({ resolvedData, item }) => {
              events.push(item === undefined ? 'list:resolveInput' : 'list:resolveInput+item')
              return resolvedData
            },
            validate: async () => {
              events.push('list:validate')
            },
            beforeOperation: async ({ context }) => {
              const seen = await context.db.Post.where({ title: { equals: 'target' } }).first()
              events.push(seen === null ? 'list:beforeOperation(absent)' : 'list:beforeOperation')
            },
            afterOperation: async ({ context }) => {
              const seen = await context.db.Post.where({ title: { equals: 'target' } }).first()
              events.push(seen === null ? 'list:afterOperation' : 'list:afterOperation(present)')
            },
          },
        },
      },
    }
  }

  describe('phase order', () => {
    test(
      'create: resolveInput, validate, beforeOperation, the row, afterOperation',
      async () => {
        const context = contextAt(spiedConfig(), { userId: 'u1' })

        expect(await context.db.Post.create({ data: { title: 'target' } })).toMatchObject({
          title: 'target',
        })

        expect(events).toEqual([
          'list:resolveInput',
          'field:resolveInput',
          'list:validate',
          'field:validate',
          'field:beforeOperation',
          'list:beforeOperation(absent)',
          'list:afterOperation(present)',
          'field:afterOperation',
        ])
      },
      BOOT,
    )

    /**
     * The negative control for the pair above: without the write between them
     * the two hooks would report the same thing, and the order assertion would
     * pass on a pipeline that wrote before `beforeOperation` ran.
     */
    test(
      'the order assertion is falsifiable: both hooks report present once the row is already there',
      async () => {
        const context = contextAt(spiedConfig(), { userId: 'u1' })
        await context.db.Post.create({ data: { title: 'target' } })
        events = []

        await context.db.Post.create({ data: { title: 'second' } })

        expect(events).toContain('list:beforeOperation')
        expect(events).not.toContain('list:beforeOperation(absent)')
      },
      BOOT,
    )

    test(
      'update: the target is read first, so resolveInput sees the existing row',
      async () => {
        const context = contextAt(spiedConfig(), { userId: 'u1' })
        const created = await context.db.Post.create({ data: { title: 'target' } })
        events = []

        expect(
          await context.db.Post.update({
            where: { id: String(created?.id) },
            data: { title: 'b' },
          }),
        ).toMatchObject({ title: 'b' })

        expect(events).toEqual([
          'list:resolveInput+item',
          'field:resolveInput',
          'list:validate',
          'field:validate',
          'field:beforeOperation',
          'list:beforeOperation',
          'list:afterOperation',
          'field:afterOperation',
        ])
      },
      BOOT,
    )

    test(
      'delete: the input-shaping phases are skipped entirely',
      async () => {
        const context = contextAt(spiedConfig(), { userId: 'u1' })
        const created = await context.db.Post.create({ data: { title: 'target' } })
        events = []

        expect(await context.db.Post.delete({ where: { id: String(created?.id) } })).toMatchObject({
          title: 'target',
        })

        expect(events).toEqual([
          'list:validate',
          'field:validate',
          'field:beforeOperation',
          'list:beforeOperation',
          'list:afterOperation',
          'field:afterOperation',
        ])
        expect(events).not.toContain('list:resolveInput')
        expect(events).not.toContain('field:resolveInput')
      },
      BOOT,
    )
  })

  describe('Silent failure', () => {
    test(
      'create: a denied operation answers null before any hook and writes nothing',
      async () => {
        const context = contextAt(spiedConfig({ operation: { create: () => false } }), {
          userId: 'u1',
        })

        expect(await context.db.Post.create({ data: { title: 'target' } })).toBeNull()
        expect(events).toEqual([])
        expect(await storedTitles(harness.url)).toEqual([])
      },
      BOOT,
    )

    /**
     * #1009: a `create` rule returning a filter reads as though it scopes the
     * create, but there is no existing row to re-check it against. It is a
     * config bug, so it is reported rather than folded into a denial.
     */
    test(
      'create: an access rule returning a filter is a loud error, not a denial',
      async () => {
        const context = contextAt(
          spiedConfig({ operation: { create: () => ({ authorId: { equals: 'someone' } }) } }),
          { userId: 'u1' },
        )

        await expect(context.db.Post.create({ data: { title: 'target' } })).rejects.toBeInstanceOf(
          InvalidCreateAccessResultError,
        )
        expect(events).toEqual([])
        expect(await storedTitles(harness.url)).toEqual([])
      },
      BOOT,
    )

    test(
      'update: a target that is not there answers null before access and before hooks',
      async () => {
        const context = contextAt(spiedConfig(), { userId: 'u1' })

        expect(
          await context.db.Post.update({ where: { id: ABSENT_ID }, data: { title: 'x' } }),
        ).toBeNull()
        expect(events).toEqual([])
      },
      BOOT,
    )

    test(
      'update: a target outside the access filter answers null and is left alone',
      async () => {
        const open = contextAt(spiedConfig(), { userId: 'u1' })
        const created = await open.db.Post.create({ data: { title: 'target', authorId: 'u2' } })
        events = []

        const mine = ({ session }: { session: Session | null }) => ({
          authorId: { equals: session?.userId },
        })
        const scoped = contextAt(spiedConfig({ operation: { update: mine } }), { userId: 'u1' })

        expect(
          await scoped.db.Post.update({ where: { id: String(created?.id) }, data: { title: 'x' } }),
        ).toBeNull()
        expect(events).not.toContain('list:beforeOperation')
        expect(await storedTitles(harness.url)).toEqual(['target'])
      },
      BOOT,
    )

    test(
      'update: a target inside the same filter runs the whole pipeline',
      async () => {
        const mine = ({ session }: { session: Session | null }) => ({
          authorId: { equals: session?.userId },
        })
        const scoped = contextAt(spiedConfig({ operation: { update: mine } }), { userId: 'u1' })
        const created = await scoped.db.Post.create({ data: { title: 'target', authorId: 'u1' } })
        events = []

        expect(
          await scoped.db.Post.update({ where: { id: String(created?.id) }, data: { title: 'x' } }),
        ).toMatchObject({ title: 'x' })
        expect(events).toContain('list:beforeOperation')
        expect(await storedTitles(harness.url)).toEqual(['x'])
      },
      BOOT,
    )

    test(
      'delete: a denied operation answers null and the row survives',
      async () => {
        const open = contextAt(spiedConfig(), { userId: 'u1' })
        const created = await open.db.Post.create({ data: { title: 'target' } })
        events = []

        const denied = contextAt(spiedConfig({ operation: { delete: () => false } }), {
          userId: 'u1',
        })

        expect(await denied.db.Post.delete({ where: { id: String(created?.id) } })).toBeNull()
        expect(events).not.toContain('list:beforeOperation')
        expect(await storedTitles(harness.url)).toEqual(['target'])
      },
      BOOT,
    )
  })

  describe('validation throws, and is not a Silent failure', () => {
    test(
      'a missing required field rejects and reaches no database',
      async () => {
        const context = contextAt(spiedConfig(), { userId: 'u1' })

        await expect(context.db.Post.create({ data: { authorId: 'u1' } })).rejects.toBeInstanceOf(
          ValidationError,
        )
        expect(events).not.toContain('list:beforeOperation')
        expect(await storedTitles(harness.url)).toEqual([])
      },
      BOOT,
    )
  })

  describe('sudo', () => {
    test(
      'create: the operation gate is skipped',
      async () => {
        const context = contextAt(spiedConfig({ operation: { create: () => false } }), {
          userId: 'u1',
        })

        expect(await context.db.Post.create({ data: { title: 'target' } })).toBeNull()
        expect(await context.sudo().db.Post.create({ data: { title: 'target' } })).toMatchObject({
          title: 'target',
        })
        expect(await storedTitles(harness.url)).toEqual(['target'])
      },
      BOOT,
    )

    test(
      'update: both the gate and the filter re-check are skipped',
      async () => {
        const open = contextAt(spiedConfig(), { userId: 'u1' })
        const created = await open.db.Post.create({ data: { title: 'target', authorId: 'u2' } })

        const mine = ({ session }: { session: Session | null }) => ({
          authorId: { equals: session?.userId },
        })
        const scoped = contextAt(spiedConfig({ operation: { update: mine } }), { userId: 'u1' })

        expect(
          await scoped
            .sudo()
            .db.Post.update({ where: { id: String(created?.id) }, data: { title: 'x' } }),
        ).toMatchObject({ title: 'x' })
        expect(await storedTitles(harness.url)).toEqual(['x'])
      },
      BOOT,
    )

    test(
      'create: the writable-field filter is skipped, so a denied field is written',
      async () => {
        const context = contextAt(spiedConfig({ secretCreate: () => false }), { userId: 'u1' })

        await expect(
          context.db.Post.create({ data: { title: 'a', secret: 's' } }),
        ).rejects.toBeInstanceOf(ValidationError)

        expect(
          await context.sudo().db.Post.create({ data: { title: 'b', secret: 's' } }),
        ).toMatchObject({ title: 'b', secret: 's' })
      },
      BOOT,
    )
  })

  describe('afterOperation sees the persisted row and the original', () => {
    test(
      'create: the persisted item, and no originalItem',
      async () => {
        const seen: Array<{ item: unknown; originalItem: unknown }> = []
        const config = withAfterOperationSpy(seen)
        const context = contextAt(config, { userId: 'u1' })

        await context.db.Post.create({ data: { title: 'target' } })

        expect(seen).toHaveLength(1)
        expect(seen[0].item).toMatchObject({ title: 'target' })
        expect(seen[0].originalItem).toBeUndefined()
      },
      BOOT,
    )

    test(
      'update: the persisted item and the row as it was',
      async () => {
        const seen: Array<{ item: unknown; originalItem: unknown }> = []
        const config = withAfterOperationSpy(seen)
        const context = contextAt(config, { userId: 'u1' })
        const created = await context.db.Post.create({ data: { title: 'before' } })
        seen.length = 0

        await context.db.Post.update({
          where: { id: String(created?.id) },
          data: { title: 'after' },
        })

        expect(seen).toHaveLength(1)
        expect(seen[0].item).toMatchObject({ title: 'after' })
        expect(seen[0].originalItem).toMatchObject({ title: 'before' })
      },
      BOOT,
    )

    test(
      'delete: the row as it was',
      async () => {
        const seen: Array<{ item: unknown; originalItem: unknown }> = []
        const config = withAfterOperationSpy(seen)
        const context = contextAt(config, { userId: 'u1' })
        const created = await context.db.Post.create({ data: { title: 'doomed' } })
        seen.length = 0

        await context.db.Post.delete({ where: { id: String(created?.id) } })

        expect(seen).toHaveLength(1)
        expect(seen[0].originalItem).toMatchObject({ title: 'doomed' })
      },
      BOOT,
    )
  })
})

/** The schema config with one `afterOperation` recording what it was handed. */
function withAfterOperationSpy(
  seen: Array<{ item: unknown; originalItem: unknown }>,
): OpenSaasConfig {
  return {
    db: { provider: 'postgresql', timestamps: true },
    lists: {
      Post: {
        fields: {
          title: text({ validation: { isRequired: true } }),
          authorId: text(),
          secret: text(),
        },
        access: { operation: OPEN },
        hooks: {
          afterOperation: async (args) => {
            seen.push({
              item: 'item' in args ? args.item : undefined,
              originalItem: 'originalItem' in args ? args.originalItem : undefined,
            })
          },
        },
      },
    },
  }
}
