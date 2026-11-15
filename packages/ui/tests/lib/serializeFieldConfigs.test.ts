import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AnyStackContext, OpenSaasConfig, Session } from '@opensaas/stack-core'
import { engineContextOf } from '@opensaas/stack-core'
import { password, relationship, select, text, virtual } from '@opensaas/stack-core/fields'
import type { FieldVocabulary } from '@opensaas/stack-core/internal'
import { createTestDatabase, type TestDatabase } from '@opensaas/stack-core/testing'
import {
  serializeFieldConfigs,
  serializeItemForForm,
  SessionVocabularyUnavailableError,
  type FieldConfigPurpose,
} from '../../src/server/index.js'
import type { SerializableFieldConfig } from '../../src/lib/serializeFieldConfig.js'
import {
  readSessionVocabulary,
  serializeFieldsForSession,
} from '../../src/lib/sessionFieldConfigs.js'
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
          ownerRead: text({ access: { read: ownsRow } }),
          brokenWrite: text({ access: { update: brokenRule } }),
          stamped: text({ access: { write: 'hooks' } }),
          adminReadsOnly: text({ access: { read: isAdmin, create: () => false } }),
          owner: relationship({ ref: 'User.docs' }),
          sealedSummary: virtual({
            type: 'string',
            access: { read: () => false },
            hooks: { resolveOutput: () => 'sealed' },
          }),
          hiddenWatchers: relationship({
            ref: 'Watcher.doc',
            many: true,
            access: { read: () => false },
          }),
          pin: password(),
          sealedPin: password({
            access: { read: () => false, create: () => false, update: () => false },
          }),
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
      Watcher: {
        fields: { label: text(), doc: relationship({ ref: 'Doc.hiddenWatchers' }) },
        access: { operation: { query: () => true, create: () => true, update: () => true } },
      },
      Settings: {
        isSingleton: true,
        fields: { siteName: text() },
        access: {
          operation: {
            query: ({ session }) => session !== null,
            create: () => true,
            update: () => true,
          },
        },
      },
      Counter: {
        db: { idField: 'int autoincrement' },
        fields: { label: text() },
        access: { operation: { query: () => true, create: () => true, update: () => true } },
      },
      Note: {
        fields: { body: text(), memo: relationship({ ref: 'Memo' }) },
        access: { operation: { query: () => true, create: () => true, update: () => true } },
      },
      Memo: {
        fields: { body: text(), ownerKey: text() },
        access: {
          operation: {
            query: ({ session }) =>
              session === null ? false : { ownerKey: { equals: String(session.userId) } },
            create: () => true,
            update: () => true,
          },
        },
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

async function seedDoc(data: Record<string, string>): Promise<Record<string, unknown>> {
  const created = await database
    .context(null)
    .sudo()
    .db.Doc.create({ data: { title: 'Plan', writeOnly: 'kept-server-side', ...data } })
  if (created === null) throw new Error('Could not seed Doc')
  return created
}

const sessions: ReadonlyArray<readonly [string, () => AnyStackContext]> = [
  ['anonymous', () => database.context(null)],
  ['author', () => database.context({ userId: 'author-1', role: 'author' })],
  ['admin', () => database.context({ userId: 'admin-1', role: 'admin' })],
  ['sudo', () => database.context(null).sudo()],
]

const purposes: readonly FieldConfigPurpose[] = ['display', 'create', 'update']

type Form = readonly [string, FieldConfigPurpose, string | null]

const forms: readonly Form[] = [
  ['display', 'display', null],
  ['create', 'create', null],
  ['update', 'update', null],
  ['update of a stored item', 'update', 'doc-1'],
]

async function serializeFor(
  context: AnyStackContext,
  purpose: FieldConfigPurpose,
  itemId: string | null,
): Promise<Record<string, SerializableFieldConfig>> {
  if (itemId === null) return await serializeFieldConfigs(context, 'Doc', purpose)
  const config = makeConfig()
  return serializeFieldsForSession({
    vocabulary: await readSessionVocabulary(context, 'Doc'),
    config,
    listKey: 'Doc',
    fields: config.lists.Doc.fields,
    purpose,
    itemId,
  }).fields
}

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
    it.each(forms)(
      'withholds every field the session can never read and may not write (%s)',
      async (_form, purpose, itemId) => {
        const context = contextOf()
        const vocabulary = await vocabularyOf(context)
        const serialized = await serializeFor(context, purpose, itemId)
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
          if (!entry || field.virtual) continue
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

  it('withholds a never-readable virtual field and edge-written to-many from an update form', async () => {
    const context = database.context({ userId: 'admin-1', role: 'admin' })
    for (const itemId of [null, 'doc-1']) {
      const serialized = await serializeFor(context, 'update', itemId)
      expect(serialized).not.toHaveProperty('sealedSummary')
      expect(serialized).not.toHaveProperty('hiddenWatchers')
    }
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

  it('answers a row-dependent update rule for the item an update form edits', async () => {
    const context = database.context({ userId: 'author-1', role: 'author' })
    const mine = await serializeFieldConfigs(
      context,
      'Doc',
      'update',
      await seedDoc({ ownerKey: 'author-1' }),
    )
    const theirs = await serializeFieldConfigs(
      context,
      'Doc',
      'update',
      await seedDoc({ ownerKey: 'someone-else' }),
    )

    expect(mine.ownerLocked.readOnly).toBeUndefined()
    expect(theirs.ownerLocked.readOnly).toBe(true)
    expect(theirs.ownerLocked.readOnlyReason).toBe(FIELD_WRITE_DENIED_REASON)
    expect(theirs.title.readOnly).toBeUndefined()
  })

  it('ignores an item outside an update form', async () => {
    const context = database.context({ userId: 'author-1', role: 'author' })
    const theirs = await seedDoc({ ownerKey: 'someone-else' })
    for (const purpose of ['create', 'display'] as const) {
      const serialized = await serializeFieldConfigs(context, 'Doc', purpose, theirs)
      expect(serialized.ownerLocked.readOnly).toBeUndefined()
    }
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

describe('serializeItemForForm', () => {
  const author = () => database.context({ userId: 'author-1', role: 'author' })

  it('takes an id, never a row', async () => {
    const stored = await seedDoc({})
    // @ts-expect-error a row is not an id: the serialiser reads the row itself
    await expect(serializeItemForForm(author(), 'Doc', stored)).resolves.toBeNull()
  })

  it('applies value transforms and leaves out what the update form withholds', async () => {
    const context = author()
    const stored = await seedDoc({ secretNote: 'classified', pin: 'hash', sealedPin: 'hash' })
    const values = await serializeItemForForm(context, 'Doc', String(stored.id))
    const fields = await serializeFieldConfigs(context, 'Doc', 'update')
    if (values === null) throw new Error('Could not serialise Doc')

    expect(values.id).toBe(stored.id)
    expect(values.title).toBe('Plan')
    expect(values.pin).toEqual({ isSet: true })
    expect(values).not.toHaveProperty('secretNote')
    expect(values).not.toHaveProperty('writeOnly')
    expect(values).not.toHaveProperty('sealedPin')
    for (const key of Object.keys(values)) {
      if (key !== 'id') expect(fields).toHaveProperty(key)
    }
  })

  it('strips a field a row-dependent read rule denies on that row', async () => {
    const context = author()
    const theirs = await seedDoc({ ownerKey: 'someone-else', ownerRead: 'theirs' })
    const mine = await seedDoc({ ownerKey: 'author-1', ownerRead: 'mine' })

    const values = await serializeItemForForm(context, 'Doc', String(theirs.id))
    const own = await serializeItemForForm(context, 'Doc', String(mine.id))

    expect(values).not.toBeNull()
    expect(values).not.toHaveProperty('ownerRead')
    expect(own?.ownerRead).toBe('mine')
  })

  it('reduces a to-one relationship to the related id and reads no to-many', async () => {
    const sudo = database.context(null).sudo()
    const user = await sudo.db.User.create({ data: { name: 'Ada' } })
    if (user === null) throw new Error('Could not seed User')
    const doc = await sudo.db.Doc.create({
      data: { title: 'Plan', writeOnly: 'w', owner: { connect: { id: user.id } } },
    })
    if (doc === null) throw new Error('Could not seed Doc')

    const values = await serializeItemForForm(author(), 'Doc', String(doc.id))

    expect(values?.owner).toBe(user.id)
    const owner = await serializeItemForForm(author(), 'User', String(user.id))
    expect(owner?.name).toBe('Ada')
    expect(owner).not.toHaveProperty('docs')
  })

  it('reads an int autoincrement row from a string id', async () => {
    const counter = await database
      .context(null)
      .sudo()
      .db.Counter.create({ data: { label: 'visits' } })
    if (counter === null) throw new Error('Could not seed Counter')

    const values = await serializeItemForForm(author(), 'Counter', String(counter.id))

    expect(values?.id).toBe(counter.id)
    expect(values?.label).toBe('visits')
  })

  it('answers null for a to-one whose target the session cannot query, with no foreign key', async () => {
    const sudo = database.context(null).sudo()
    const memo = await sudo.db.Memo.create({ data: { body: 'private', ownerKey: 'someone-else' } })
    if (memo === null) throw new Error('Could not seed Memo')
    const note = await sudo.db.Note.create({
      data: { body: 'n', memo: { connect: { id: memo.id } } },
    })
    if (note === null) throw new Error('Could not seed Note')

    const values = await serializeItemForForm(author(), 'Note', String(note.id))

    expect(values?.body).toBe('n')
    expect(values?.memo).toBeNull()
    expect(values).not.toHaveProperty('memoId')
    expect(JSON.stringify(values)).not.toContain(String(memo.id))
  })

  it('reads a singleton without creating it, and only by its own id', async () => {
    const sudo = database.context(null).sudo()
    await expect(serializeItemForForm(author(), 'Settings', 1)).resolves.toBeNull()
    await expect(
      sudo.db.Settings.update({ where: { id: 1 }, data: { siteName: 'probe' } }),
    ).resolves.toBeNull()

    const seeded = await sudo.db.Settings.get?.()
    if (!seeded) throw new Error('Could not seed Settings')
    await sudo.db.Settings.update({ where: { id: seeded.id }, data: { siteName: 'Stack' } })

    const values = await serializeItemForForm(author(), 'Settings', '1')
    expect(values?.id).toBe(seeded.id)
    expect(values?.siteName).toBe('Stack')
    await expect(serializeItemForForm(author(), 'Settings', 2)).resolves.toBeNull()
    await expect(serializeItemForForm(database.context(null), 'Settings', 1)).resolves.toBeNull()
  })

  it('returns null for an id the session cannot query', async () => {
    const sudo = database.context(null).sudo()
    const memo = await sudo.db.Memo.create({ data: { body: 'private', ownerKey: 'someone-else' } })
    if (memo === null) throw new Error('Could not seed Memo')

    await expect(serializeItemForForm(author(), 'Memo', String(memo.id))).resolves.toBeNull()
  })

  it('returns null for a missing id', async () => {
    await expect(
      serializeItemForForm(author(), 'Doc', '0190a8b0-0000-7000-8000-000000000000'),
    ).resolves.toBeNull()
  })

  it('returns null for an id the list cannot hold', async () => {
    await expect(serializeItemForForm(author(), 'Doc', 'not-an-id')).resolves.toBeNull()
  })

  it('refuses a list the config does not declare', async () => {
    await expect(
      serializeItemForForm(database.context(null), 'Nope', '0190a8b0-0000-7000-8000-000000000000'),
    ).rejects.toBeInstanceOf(SessionVocabularyUnavailableError)
  })
})
