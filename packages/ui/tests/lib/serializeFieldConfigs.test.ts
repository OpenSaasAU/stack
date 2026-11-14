import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AnyStackContext, OpenSaasConfig, Session } from '@opensaas/stack-core'
import { engineContextOf } from '@opensaas/stack-core'
import { relationship, select, text } from '@opensaas/stack-core/fields'
import type { FieldVocabulary } from '@opensaas/stack-core/internal'
import { createTestDatabase, type TestDatabase } from '@opensaas/stack-core/testing'
import {
  serializeFieldConfigs,
  SessionVocabularyUnavailableError,
  type FieldConfigPurpose,
} from '../../src/server/index.js'
import { FIELD_WRITE_DENIED_REASON } from '../../src/lib/serializeFieldConfig.js'

const BOOT = 120_000

const isAdmin = ({ session }: { session: Session | null }): boolean => session?.role === 'admin'

const ownsRow = ({ session, item }: { session: Session | null; item?: Record<string, unknown> }) =>
  item?.ownerKey === session?.userId

function brokenRule(): boolean {
  throw new Error('rule failed')
}

function makeConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      Doc: {
        fields: {
          title: text({ validation: { isRequired: true } }),
          ownerKey: text(),
          secretNote: text({
            access: { read: () => false, create: () => false, update: () => false },
          }),
          clearance: select({
            options: [{ label: 'ClearanceCosmicLabel', value: 'a' }],
            access: { read: isAdmin, create: isAdmin, update: isAdmin },
          }),
          writeOnly: text({ validation: { isRequired: true }, access: { read: () => false } }),
          ownerLocked: text({ access: { create: ownsRow, update: ownsRow } }),
          brokenWrite: text({ access: { update: brokenRule } }),
          stamped: text({ access: { write: 'hooks' } }),
          adminReadsOnly: text({ access: { read: isAdmin, create: () => false } }),
          owner: relationship({ ref: 'User.docs' }),
        },
        access: {
          operation: {
            query: () => true,
            create: ({ session }) => session !== null,
            update: ({ session }) => session !== null,
            delete: isAdmin,
          },
        },
      },
      User: {
        fields: { name: text(), docs: relationship({ ref: 'Doc.owner', many: true }) },
        access: { operation: { query: () => true, create: () => true, update: () => true } },
      },
    },
  }
}

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase(makeConfig())
}, BOOT)

afterAll(async () => {
  await database?.close()
})

const sessions: ReadonlyArray<readonly [string, () => AnyStackContext]> = [
  ['anonymous', () => database.context(null)],
  ['author', () => database.context({ userId: 'author-1', role: 'author' })],
  ['admin', () => database.context({ userId: 'admin-1', role: 'admin' })],
  ['sudo', () => database.context(null).sudo()],
]

const purposes: readonly FieldConfigPurpose[] = ['display', 'create', 'update']

async function vocabularyOf(context: AnyStackContext): Promise<Map<string, FieldVocabulary>> {
  const vocabulary = await engineContextOf(context)._sessionVocabulary?.('Doc')
  if (!vocabulary) throw new Error('no vocabulary for Doc')
  return new Map(vocabulary.fields)
}

function writeDeniedFor(entry: FieldVocabulary, purpose: FieldConfigPurpose): boolean {
  return purpose === 'display'
    ? entry.create === 'deny' && entry.update === 'deny'
    : entry[purpose] === 'deny'
}

describe('serializeFieldConfigs', () => {
  describe.each(sessions)('for the %s session', (_name, contextOf) => {
    it.each(purposes)(
      'withholds every field the session can never read and may not write (%s)',
      async (purpose) => {
        const context = contextOf()
        const vocabulary = await vocabularyOf(context)
        const serialized = await serializeFieldConfigs(context, 'Doc', purpose)
        const wire = JSON.stringify(serialized)

        for (const [fieldName, entry] of vocabulary) {
          if (entry.read !== 'deny') continue
          if (purpose === 'display' || writeDeniedFor(entry, purpose)) {
            expect(serialized).not.toHaveProperty(fieldName)
            expect(wire).not.toContain(`"${fieldName}"`)
          } else {
            expect(serialized[fieldName]?.readOnly).toBeUndefined()
          }
        }
        if (vocabulary.get('clearance')?.read === 'deny') {
          expect(wire).not.toContain('ClearanceCosmicLabel')
        }
      },
    )

    it.each(purposes)(
      'marks write dispositions as the vocabulary answers them (%s)',
      async (purpose) => {
        const context = contextOf()
        const vocabulary = await vocabularyOf(context)
        const serialized = await serializeFieldConfigs(context, 'Doc', purpose)

        for (const [fieldName, field] of Object.entries(serialized)) {
          const entry = vocabulary.get(fieldName)
          expect(entry).toBeDefined()
          if (!entry) continue
          if (writeDeniedFor(entry, purpose)) {
            expect(field.readOnly).toBe(true)
          } else {
            expect(field.readOnly).toBeUndefined()
          }
        }
      },
    )
  })

  it('keeps a write-only field editable and not required on an update form', async () => {
    const serialized = await serializeFieldConfigs(
      database.context({ userId: 'author-1' }),
      'Doc',
      'update',
    )
    expect(serialized.writeOnly).toBeDefined()
    expect(serialized.writeOnly.readOnly).toBeUndefined()
    expect(serialized.writeOnly.validation?.isRequired).toBe(false)
  })

  it('withholds a write-only field from display', async () => {
    const serialized = await serializeFieldConfigs(database.context({ userId: 'author-1' }), 'Doc')
    expect(serialized).not.toHaveProperty('writeOnly')
  })

  it('leaves a create rule that optional-chains item editable on a create form (#2383)', async () => {
    const serialized = await serializeFieldConfigs(
      database.context({ userId: 'author-1' }),
      'Doc',
      'create',
    )
    expect(serialized.ownerLocked.readOnly).toBeUndefined()
  })

  it('marks a write rule that throws read-only and logs it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const serialized = await serializeFieldConfigs(
        database.context({ userId: 'author-1' }),
        'Doc',
        'update',
      )
      expect(serialized.brokenWrite.readOnly).toBe(true)
      expect(serialized.brokenWrite.readOnlyReason).toBe(FIELD_WRITE_DENIED_REASON)
    } finally {
      warn.mockRestore()
      error.mockRestore()
    }
  })

  it('marks every field read-only on a create form when the list denies create', async () => {
    const serialized = await serializeFieldConfigs(database.context(null), 'Doc', 'create')
    expect(serialized.title.readOnly).toBe(true)
    expect(serialized.title.readOnlyReason).toBe(FIELD_WRITE_DENIED_REASON)
  })

  it('refuses a list the config does not declare', async () => {
    await expect(serializeFieldConfigs(database.context(null), 'Nope')).rejects.toBeInstanceOf(
      SessionVocabularyUnavailableError,
    )
  })
})
