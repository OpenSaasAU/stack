import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { list } from '@opensaas/stack-core'
import { text, json, integer, password, virtual } from '@opensaas/stack-core/fields'
import { createTestDatabase, type TestDatabase } from '@opensaas/stack-core/testing'
import { resolveEditableColumns } from '../../src/components/RelationshipTable.js'
import type { RelationshipTableSection } from '../../src/lib/deriveItemView.js'
import { readSessionVocabulary } from '../../src/lib/sessionFieldConfigs.js'

const BOOT = 120_000

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Item: list({
      access: { operation: { query: () => true, update: () => true } },
      fields: {
        title: text(),
        count: integer(),
        secret: password(),
        computed: virtual({ type: 'string', hooks: { resolveOutput: () => 'x' } }),
        payload: json(),
        metadata: json(),
      },
    }),
  },
}

function section(columns: string[]): RelationshipTableSection {
  return {
    fieldName: 'items',
    ref: 'Item.parent',
    relatedListKey: 'Item',
    backReferenceField: 'parent',
    columns,
    take: 10,
    sumColumns: [],
    removeAction: 'disconnect',
    disconnectable: true,
  }
}

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase(config)
}, BOOT)

afterAll(async () => {
  await database?.close()
})

async function editable(columns: string[]): Promise<string[]> {
  const vocabulary = await readSessionVocabulary(database.context(null), 'Item')
  return resolveEditableColumns(section(columns), config.lists.Item, vocabulary)
}

describe('resolveEditableColumns — json exclusion (#761)', () => {
  it(
    'excludes json columns from inline-editable columns',
    async () => {
      const columns = await editable(['title', 'metadata'])

      expect(columns).toEqual(['title'])
      expect(columns).not.toContain('metadata')
    },
    BOOT,
  )

  it(
    'keeps the existing scalar / relationship / virtual / password / system exclusions intact',
    async () => {
      expect(
        await editable(['id', 'title', 'count', 'secret', 'computed', 'payload', 'createdAt']),
      ).toEqual(['title', 'count'])
    },
    BOOT,
  )
})
