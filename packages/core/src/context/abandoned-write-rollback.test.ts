import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { relationship, text } from '../fields/index.js'
import { createTestContext, type TestContext } from '../testing/context.js'
import { TransactionRolledBackError } from './index.js'

const BOOT = 120_000
const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }
const afterTransaction = vi.fn()

function schemaConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql', timestamps: true },
    lists: {
      Secret: {
        fields: { name: text() },
        access: { operation: { ...OPEN, query: () => false } },
      },
      Audit: {
        fields: { note: text() },
        access: { operation: OPEN },
      },
      Post: {
        fields: { title: text(), secret: relationship({ ref: 'Secret' }) },
        access: { operation: OPEN },
        hooks: {
          resolveInput: async ({ context, resolvedData }) => {
            await context.db.Audit.create({ data: { note: 'hook ran' } })
            return resolvedData
          },
          afterTransaction,
        },
      },
    },
  }
}

describe('a write that returns null after its hooks ran rolls the hooks back', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(schemaConfig(), { userId: 'u1' })
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    await harness.truncate()
    afterTransaction.mockReset()
  })

  const auditCount = async (): Promise<number> =>
    (await harness.context.sudo().db.Audit.all()).length

  async function secretId(): Promise<string> {
    const secret = await harness.context.sudo().db.Secret.create({ data: { name: 's' } })
    if (secret === null || typeof secret.id !== 'string') throw new Error('seed failed')
    return secret.id
  }

  test(
    'an owned write with an unreachable connect returns null and leaves no hook writes',
    async () => {
      const id = await secretId()
      const post = await harness.context.db.Post.create({
        data: { title: 't', secret: { connect: { id } } },
      })
      expect(post).toBeNull()
      expect(await auditCount()).toBe(0)
      expect(afterTransaction.mock.calls[0]?.[0].status).toBe('rolled-back')
    },
    BOOT,
  )

  test(
    'a joined write poisons the enclosing transaction',
    async () => {
      const id = await secretId()
      let inner: unknown = 'unset'
      const run = harness.context.transaction(async (tx) => {
        inner = await tx.db.Post.create({ data: { title: 't', secret: { connect: { id } } } })
      })
      const rejection = await run.catch((err: unknown) => err)
      expect(inner).toBeNull()
      expect(rejection).toBeInstanceOf(TransactionRolledBackError)
      expect(await auditCount()).toBe(0)
    },
    BOOT,
  )
})
