import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import type { AnyStackContext, OpenSaasConfig } from '@opensaas/stack-core'
import { createTestContext, type TestContext } from '@opensaas/stack-core/testing'
import { integer, relationship, text } from '@opensaas/stack-core/fields'
import { RelationshipTable } from '../../src/components/RelationshipTable.js'
import type { RelationshipTableSection } from '../../src/lib/deriveItemView.js'

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Team: { fields: { members: relationship({ ref: 'Member.team', many: true }) } },
    Member: {
      fields: {
        name: text(),
        team: relationship({ ref: 'Team.members' }),
        salary: integer({
          ui: { valueForClientSerialization: ({ value }) => ({ isSet: value != null }) },
        }),
        apiToken: text({
          ui: { valueForClientSerialization: ({ value }) => ({ isSet: !!value }) },
        }),
      },
    },
  },
}

const section: RelationshipTableSection = {
  fieldName: 'members',
  ref: 'Member.team',
  relatedListKey: 'Member',
  backReferenceField: 'team',
  columns: ['name', 'apiToken'],
  take: 10,
  sumColumns: [],
  removeAction: 'disconnect',
  disconnectable: true,
}

describe('RelationshipTable client value transforms', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(config, { userId: 'u1' })
  }, 120_000)

  afterAll(async () => {
    await harness?.close()
  })

  it('applies ui.valueForClientSerialization to rows before they reach the client', async () => {
    const element = await RelationshipTable({
      config,
      section,
      rows: [{ id: 'm1', name: 'm', apiToken: 'sk_live_SECRET' }],
      total: 1,
      basePath: '/admin',
      context: harness.context as unknown as AnyStackContext,
      parentListKey: 'Team',
      parentId: 't1',
      serverAction: async () => null,
      readOnly: true,
    })

    expect(element.props.rows).toEqual([{ id: 'm1', name: 'm', apiToken: { isSet: true } }])
    expect(JSON.stringify(element.props.rows)).not.toContain('sk_live_SECRET')
  })

  it('does not total a redacted column into the footer sums', async () => {
    const element = await RelationshipTable({
      config,
      section: { ...section, columns: ['name', 'salary'], sumColumns: ['salary'] },
      rows: [
        { id: 'm1', name: 'a', salary: 100 },
        { id: 'm2', name: 'b', salary: 250 },
      ],
      total: 2,
      basePath: '/admin',
      context: harness.context as unknown as AnyStackContext,
      parentListKey: 'Team',
      parentId: 't1',
      serverAction: async () => null,
      readOnly: true,
    })

    expect(element.props.sums).toEqual({ salary: 0 })
  })
})
