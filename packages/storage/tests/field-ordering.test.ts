import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { engineContextOf, type OpenSaasConfig } from '@opensaas/stack-core'
import { canOrderBy } from '@opensaas/stack-core/internal'
import { createTestDatabase, type TestDatabase } from '@opensaas/stack-core/testing'
import { file, image } from '../src/fields/index.js'

const BOOT = 120_000

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Asset: {
      fields: {
        photo: image({ storage: 'images' }),
        doc: file({ storage: 'documents' }),
        keystonePhoto: image({ storage: 'images', db: { columns: 'keystone' } }),
        keystoneDoc: file({ storage: 'documents', db: { columns: 'keystone' } }),
      },
      access: { operation: { query: () => true } },
    },
  },
}

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase(config)
}, BOOT)

afterAll(async () => {
  await database?.close()
})

describe('an asset field has no order', () => {
  it.each(['photo', 'doc', 'keystonePhoto', 'keystoneDoc'])(
    '%s',
    async (key) => {
      const context = engineContextOf(database.context(null))
      expect(await canOrderBy(context, config, 'Asset', key)).toBe(false)
    },
    BOOT,
  )
})
