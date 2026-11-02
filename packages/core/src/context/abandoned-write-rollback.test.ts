import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { relationship, select, text } from '../fields/index.js'
import { createTestContext, type TestContext } from '../testing/context.js'
import { TransactionRolledBackError } from './index.js'

const BOOT = 120_000
const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }
const afterTransaction = vi.fn()
const afterDocTransaction = vi.fn()

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
      Doc: {
        fields: {
          title: text(),
          status: select({
            options: [
              { label: 'Draft', value: 'draft' },
              { label: 'Archived', value: 'archived' },
            ],
            defaultValue: 'draft',
          }),
        },
        access: {
          operation: { ...OPEN, delete: () => ({ status: { equals: 'draft' } }) },
        },
        hooks: {
          beforeOperation: async ({ operation, item, context }) => {
            if (operation !== 'delete' || !item) return
            await context.db.Audit.create({ data: { note: 'delete hook ran' } })
            await context.db.Doc.update({
              where: { id: String(item.id) },
              data: { status: 'archived' },
            })
          },
          afterTransaction: afterDocTransaction,
        },
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
    afterDocTransaction.mockReset()
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

  async function draftDocId(): Promise<string> {
    const doc = await harness.context.sudo().db.Doc.create({ data: { title: 'd' } })
    if (doc === null || typeof doc.id !== 'string') throw new Error('seed failed')
    return doc.id
  }

  const docStatus = async (id: string): Promise<unknown> =>
    (
      await harness.context
        .sudo()
        .db.Doc.where({ id: { equals: id } })
        .first()
    )?.status

  test(
    'an owned delete that returns null leaves no hook writes',
    async () => {
      const id = await draftDocId()
      const result = await harness.context.db.Doc.delete({ where: { id } })
      expect(result).toBeNull()
      expect(await auditCount()).toBe(0)
      expect(await docStatus(id)).toBe('draft')
      const outcomes = afterDocTransaction.mock.calls.map((c) => `${c[0].operation}:${c[0].status}`)
      expect(outcomes).toContain('delete:rolled-back')
      expect(outcomes).not.toContain('update:committed')
    },
    BOOT,
  )

  test(
    'a joined delete that returns null poisons the enclosing transaction',
    async () => {
      const id = await draftDocId()
      let inner: unknown = 'unset'
      const run = harness.context.transaction(async (tx) => {
        inner = await tx.db.Doc.delete({ where: { id } })
      })
      const rejection = await run.catch((err: unknown) => err)
      expect(inner).toBeNull()
      expect(rejection).toBeInstanceOf(TransactionRolledBackError)
      expect(await auditCount()).toBe(0)
      expect(await docStatus(id)).toBe('draft')
    },
    BOOT,
  )
})
