import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { AccessControlledDB, Session } from './index.js'
import type { OpenSaasConfig } from '../config/types.js'
import { text, virtual } from '../fields/index.js'
import { createTestContext, ormClientFor, type TestContext } from '../testing/context.js'
import type { StackContext } from '../types/context.js'
import { getContext } from '../context/index.js'
import { RESOLVE_CHAIN_MAX_LENGTH } from './depth-limits.js'
import { ResolveOutputCycleError } from './errors.js'

/**
 * The resolve chain (#844, ADR-0023): what happens when a `resolveOutput` hook
 * issues its own read, whose Field Visibility pass runs another hook.
 *
 * A cycle is refused loudly; a merely long chain is a cost limit that omits
 * the field and warns. Both are exercised through real reads on a real
 * database, so the chain is the one the engine actually threads rather than
 * one a double let through.
 */

const BOOT = 120_000

const OPEN = { query: () => true, create: () => true }

/** Two lists with no relationship between them; only their hooks read each other. */
function schemaConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql', timestamps: true },
    lists: {
      Ping: { fields: { name: text() }, access: { operation: OPEN } },
      Pong: { fields: { name: text() }, access: { operation: OPEN } },
      Link0: { fields: { name: text() }, access: { operation: OPEN } },
      Link1: { fields: { name: text() }, access: { operation: OPEN } },
      Link2: { fields: { name: text() }, access: { operation: OPEN } },
      Link3: { fields: { name: text() }, access: { operation: OPEN } },
      Link4: { fields: { name: text() }, access: { operation: OPEN } },
      Link5: { fields: { name: text() }, access: { operation: OPEN } },
      Link6: { fields: { name: text() }, access: { operation: OPEN } },
    },
  }
}

const LINKS = ['Link0', 'Link1', 'Link2', 'Link3', 'Link4', 'Link5', 'Link6'] as const

describe('the resolve chain', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(schemaConfig(), null)
  }, BOOT)

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

  /** One row per list a test reads, so a hook's own read has something to walk. */
  async function seed(lists: readonly string[]): Promise<void> {
    const sudo = harness.context.sudo()
    for (const list of lists) await sudo.db[list].create({ data: { name: list } })
  }

  test(
    'two hooks that read each other are refused rather than left to recurse',
    async () => {
      await seed(['Ping', 'Pong'])

      const cyclic: OpenSaasConfig = {
        ...schemaConfig(),
        lists: {
          ...schemaConfig().lists,
          Ping: {
            fields: {
              name: text(),
              echo: virtual({
                type: 'string',
                hooks: {
                  resolveOutput: async ({ context }) => {
                    await context.db.Pong.all()
                    return 'ping'
                  },
                },
              }),
            },
            access: { operation: OPEN },
          },
          Pong: {
            fields: {
              name: text(),
              echo: virtual({
                type: 'string',
                hooks: {
                  resolveOutput: async ({ context }) => {
                    await context.db.Ping.all()
                    return 'pong'
                  },
                },
              }),
            },
            access: { operation: OPEN },
          },
        },
      }

      await expect(contextAt(cyclic).db.Ping.all()).rejects.toBeInstanceOf(ResolveOutputCycleError)
    },
    BOOT,
  )

  test(
    'the refusal names every pair on the chain, in order, including the repeat',
    async () => {
      await seed(['Ping', 'Pong'])

      const cyclic: OpenSaasConfig = {
        ...schemaConfig(),
        lists: {
          ...schemaConfig().lists,
          Ping: {
            fields: {
              name: text(),
              echo: virtual({
                type: 'string',
                hooks: {
                  resolveOutput: async ({ context }) => {
                    await context.db.Pong.all()
                    return 'ping'
                  },
                },
              }),
            },
            access: { operation: OPEN },
          },
          Pong: {
            fields: {
              name: text(),
              echo: virtual({
                type: 'string',
                hooks: {
                  resolveOutput: async ({ context }) => {
                    await context.db.Ping.all()
                    return 'pong'
                  },
                },
              }),
            },
            access: { operation: OPEN },
          },
        },
      }

      const raised = await contextAt(cyclic)
        .db.Ping.all()
        .then(
          () => undefined,
          (error: unknown) => error,
        )

      expect(raised).toBeInstanceOf(ResolveOutputCycleError)
      if (!(raised instanceof ResolveOutputCycleError)) throw new Error('not a cycle error')
      expect(raised.chain).toEqual([
        { listKey: 'Ping', fieldKey: 'echo' },
        { listKey: 'Pong', fieldKey: 'echo' },
        { listKey: 'Ping', fieldKey: 'echo' },
      ])
    },
    BOOT,
  )

  /**
   * A chain that terminates but is longer than the cap. It is a cost limit,
   * not a denial, so the field is omitted and the read still answers.
   */
  test(
    'an acyclic chain past the cap omits the field and warns once, without throwing',
    async () => {
      await seed(LINKS)
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      try {
        const config: OpenSaasConfig = { ...schemaConfig(), lists: { ...schemaConfig().lists } }
        LINKS.forEach((listKey, index) => {
          const next = LINKS[index + 1]
          config.lists[listKey] = {
            fields: {
              name: text(),
              hop: virtual({
                type: 'string',
                hooks: {
                  resolveOutput: async ({ context }) => {
                    if (next) await context.db[next].all()
                    return listKey
                  },
                },
              }),
            },
            access: { operation: OPEN },
          }
        })

        const [row] = await contextAt(config).db.Link0.all()

        expect(row).toMatchObject({ name: 'Link0' })
        expect(row.hop).toBe('Link0')
        const omissions = warn.mock.calls.filter((call) =>
          String(call[0]).includes('RESOLVE_CHAIN_MAX_LENGTH'),
        )
        expect(omissions).toHaveLength(1)
        expect(String(omissions[0][0])).toContain(`Link${RESOLVE_CHAIN_MAX_LENGTH}.hop`)
      } finally {
        warn.mockRestore()
      }
    },
    BOOT,
  )

  /**
   * The chain is per-invocation, not a counter shared across a read. Two
   * sibling rows each start at length 1, so neither pushes the other over the
   * cap and both compute.
   */
  test(
    'sibling rows each observe their own chain rather than a shared counter',
    async () => {
      const sudo = harness.context.sudo()
      await sudo.db.Ping.create({ data: { name: 'a' } })
      await sudo.db.Ping.create({ data: { name: 'b' } })
      await sudo.db.Ping.create({ data: { name: 'c' } })
      await seed(['Pong'])

      const config: OpenSaasConfig = {
        ...schemaConfig(),
        lists: {
          ...schemaConfig().lists,
          Ping: {
            fields: {
              name: text(),
              echo: virtual({
                type: 'string',
                hooks: {
                  resolveOutput: async ({ context }) => {
                    const seen = await context.db.Pong.all()
                    return `pong:${seen.length}`
                  },
                },
              }),
            },
            access: { operation: OPEN },
          },
        },
      }

      const read = await contextAt(config).db.Ping.all()

      expect(read.map((row) => row.name).sort()).toEqual(['a', 'b', 'c'])
      expect(read.map((row) => row.echo)).toEqual(['pong:1', 'pong:1', 'pong:1'])
    },
    BOOT,
  )
})
