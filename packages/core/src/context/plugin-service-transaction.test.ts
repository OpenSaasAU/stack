import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { AccessContext, AccessControlledDB, Session } from '../access/index.js'
import { config } from '../config/index.js'
import type { OpenSaasConfig, Plugin } from '../config/types.js'
import { text } from '../fields/index.js'
import { createTestContext, ormClientFor, type TestContext } from '../testing/context.js'
import type { StackContext } from '../types/context.js'
import { getContext } from './index.js'

const BOOT = 120_000
const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }

interface AuditService {
  note: (context: AccessContext, note: string) => Promise<unknown>
  touch: (context: AccessContext, id: string) => Promise<unknown>
}

const auditPlugin: Plugin = {
  name: 'svc',
  init: async () => {},
  runtime: (): AuditService => ({
    note: (context, note) => context.db.Audit.create({ data: { note } }),
    touch: (context, id) => context.db.Doc.update({ where: { id }, data: { title: 'touched' } }),
  }),
}

function serviceOf(context: AccessContext): AuditService {
  return context.plugins.svc as AuditService
}

async function build(
  hooks: NonNullable<OpenSaasConfig['lists'][string]['hooks']>,
): Promise<OpenSaasConfig> {
  return await config({
    db: { provider: 'postgresql', timestamps: true },
    plugins: [auditPlugin],
    lists: {
      Doc: { fields: { title: text() }, access: { operation: OPEN }, hooks },
      Audit: { fields: { note: text() }, access: { operation: OPEN } },
    },
  })
}

describe('plugin services called from a hook', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(await build({}), { userId: 'u1' })
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    await harness.truncate()
  })

  function contextAt(
    cfg: OpenSaasConfig,
    session: Session | null,
  ): StackContext<AccessControlledDB> {
    const orm = ormClientFor(harness.data, harness.client.orm)
    return getContext(cfg, orm, session, undefined, false, undefined, undefined, harness.client)
  }

  test(
    'a service given the hook context writes inside the transaction and rolls back with it',
    async () => {
      const cfg = await build({
        beforeOperation: async (args) => {
          if (args.operation === 'create') await serviceOf(args.context).note(args.context, 'x')
        },
        afterOperation: async () => {
          throw new Error('boom')
        },
      })

      await expect(
        contextAt(cfg, { userId: 'u1' }).db.Doc.create({ data: { title: 'a' } }),
      ).rejects.toThrow('boom')

      expect(await harness.context.db.Audit.all()).toEqual([])
      expect(await harness.context.db.Doc.all()).toEqual([])
    },
    BOOT,
  )

  test(
    'a service given the hook context can update the row being written without hanging',
    async () => {
      const seeded = await harness.context.db.Doc.create({ data: { title: 'a' } })
      if (seeded === null) throw new Error('seed denied')

      const cfg = await build({
        afterOperation: async (args) => {
          if (args.operation === 'update' && args.item.title === 'b') {
            await serviceOf(args.context).touch(args.context, args.item.id)
          }
        },
      })

      await contextAt(cfg, { userId: 'u1' }).db.Doc.update({
        where: { id: seeded.id },
        data: { title: 'b' },
      })

      const [row] = await harness.context.db.Doc.all()
      expect(row.title).toBe('touched')
    },
    BOOT,
  )
})
