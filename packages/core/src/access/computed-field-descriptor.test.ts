import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { AccessControlledDB, Session } from './index.js'
import type { FieldConfig, OpenSaasConfig } from '../config/types.js'
import { text } from '../fields/index.js'
import { createTestContext, ormClientFor, type TestContext } from '../testing/context.js'
import type { StackContext } from '../types/context.js'
import { getContext } from '../context/index.js'

/**
 * Issue #1531: a third-party field can declare a `{ kind: 'computed' }`
 * contract descriptor without also setting core's `virtual` flag or
 * `type: 'virtual'` — #1309/#1529 fixed the generator's own sorting of such a
 * field, but `field-visibility.ts`'s virtual-field pass still gated on
 * `fieldConfig.virtual` alone, so its `resolveOutput` never ran on a real
 * read. These prove the runtime against a real database, both before relying
 * on the generator fix and as its regression guard.
 */

const OPEN = { query: () => true, create: () => true }

/** A field that stores nothing by its contract descriptor, but sets neither `virtual` nor `type: 'virtual'`. */
function thirdPartyComputed(args: {
  needs?: string[]
  resolveOutput: (params: { item: Record<string, unknown> }) => unknown
}): FieldConfig {
  return {
    type: 'thirdPartyComputed',
    outputType: 'string',
    needs: args.needs,
    getContractField: () => ({ kind: 'computed' }),
    hooks: { resolveOutput: ({ item }) => args.resolveOutput({ item }) },
  }
}

function schemaConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: { Post: { fields: { title: text() }, access: { operation: OPEN } } },
  }
}

describe('a computed field with no `virtual` flag', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(schemaConfig(), null)
  }, 120_000)

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    await harness.truncate()
  })

  function contextAt(
    config: OpenSaasConfig,
    session: Session | null = null,
  ): StackContext<AccessControlledDB> {
    const orm = ormClientFor(harness.data, harness.client.orm)
    return getContext(config, orm, session, undefined, false, undefined, undefined, harness.client)
  }

  test('its resolveOutput runs on a real read, exactly like a flagged virtual field', async () => {
    const config: OpenSaasConfig = {
      ...schemaConfig(),
      lists: {
        Post: {
          fields: {
            title: text(),
            summary: thirdPartyComputed({
              needs: ['title'],
              resolveOutput: ({ item }) => `summary:${String(item.title)}`,
            }),
          },
          access: { operation: OPEN },
        },
      },
    }

    const context = contextAt(config)
    const created = await context.db.Post.create({ data: { title: 'Hello' } })
    expect(created).not.toBeNull()

    const posts = await context.db.Post.all()
    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({ title: 'Hello', summary: 'summary:Hello' })
  })

  test('field-level read access still gates it', async () => {
    const config: OpenSaasConfig = {
      ...schemaConfig(),
      lists: {
        Post: {
          fields: {
            title: text(),
            summary: {
              ...thirdPartyComputed({ resolveOutput: () => 'secret' }),
              access: { read: () => false },
            },
          },
          access: { operation: OPEN },
        },
      },
    }

    const context = contextAt(config)
    await context.db.Post.create({ data: { title: 'Hello' } })

    const posts = await context.db.Post.all()
    expect(posts).toHaveLength(1)
    expect(posts[0]).not.toHaveProperty('summary')
  })

  test('a hookless field of the same shape produces no value and does no work', async () => {
    const config: OpenSaasConfig = {
      ...schemaConfig(),
      lists: {
        Post: {
          fields: {
            title: text(),
            summary: {
              type: 'thirdPartyComputed',
              outputType: 'string',
              getContractField: () => ({ kind: 'computed' }),
            },
          },
          access: { operation: OPEN },
        },
      },
    }

    const context = contextAt(config)
    await context.db.Post.create({ data: { title: 'Hello' } })

    const posts = await context.db.Post.all()
    expect(posts).toHaveLength(1)
    expect(posts[0]).not.toHaveProperty('summary')
  })
})
