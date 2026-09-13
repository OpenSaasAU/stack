import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { createTestContext, type TestContext } from '@opensaas/stack-core/testing'
import { getRelationshipOptions } from '../../src/lib/getRelationshipOptions.js'

const BOOT = 120_000

function makeConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      User: {
        fields: { name: text() },
        access: { operation: { query: () => true, create: () => true } },
      },
    },
  }
}

describe('getRelationshipOptions (stack-ui re-export)', () => {
  let harness: TestContext
  let context: AccessContext

  beforeAll(async () => {
    harness = await createTestContext(makeConfig(), null)
    context = harness.context as unknown as AccessContext

    const sudo = harness.context.sudo()
    await sudo.db.User.create({ data: { name: 'Ada Lovelace' } })
    await sudo.db.User.create({ data: { name: 'Alan Turing' } })
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  it(
    'resolves { id, label }[] for a relationship field against a full AccessContext',
    async () => {
      const result = await getRelationshipOptions(context, makeConfig(), 'User', {})

      expect(result.map((option) => option.label).sort()).toEqual(['Ada Lovelace', 'Alan Turing'])
    },
    BOOT,
  )

  it(
    'returns [] for an unknown related list',
    async () => {
      expect(await getRelationshipOptions(context, makeConfig(), 'Missing', {})).toEqual([])
    },
    BOOT,
  )
})
