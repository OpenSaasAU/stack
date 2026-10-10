import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { text } from '../fields/index.js'
import type { OpenSaasConfig } from '../config/types.js'
import { createTestContext, type TestContext } from '../testing/context.js'

const BOOT = 120_000

const mutateInPlace = async ({ resolvedData }: { resolvedData: Record<string, unknown> }) => {
  if (resolvedData.title === 'drop') delete resolvedData.note
  else resolvedData.note = 'set-by-hook'
  return resolvedData
}

function schemaConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      Post: {
        fields: {
          title: text(),
          note: text({ access: { create: () => false } }),
        },
        access: { operation: { query: () => true, create: () => true } },
        hooks: { resolveInput: mutateInPlace },
      },
    },
  }
}

describe('resolveInput mutating resolvedData in place', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(schemaConfig(), { userId: 'u1' })
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  test('hook-set keys are not gated as caller input and the caller data is untouched', async () => {
    const data = { title: 'x' }
    const post = await harness.context.db.Post.create({ data })

    expect(post).not.toBeNull()
    expect(data).toEqual({ title: 'x' })
  })

  test('a caller-supplied denied key is still refused', async () => {
    await expect(
      harness.context.db.Post.create({ data: { title: 'x', note: 'caller' } }),
    ).rejects.toThrow(/note/)
  })

  test('a hook deleting a caller-supplied denied key does not hide it from the gate', async () => {
    await expect(
      harness.context.db.Post.create({ data: { title: 'drop', note: 'caller' } }),
    ).rejects.toThrow(/note/)
  })
})
