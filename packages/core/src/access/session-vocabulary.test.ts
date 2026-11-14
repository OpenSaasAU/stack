import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import type { FieldAccessControl, Session } from './types.js'
import type { AccessAnswer, FieldVocabulary, SessionVocabulary } from './session-vocabulary.js'
import { engineContextOf, type AnyStackContext } from '../context/engine-context.js'
import { relationship, text, virtual } from '../fields/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'

const BOOT = 120_000

const anonymous = null
const author: Session = { userId: 'author-1', role: 'author' }
const admin: Session = { userId: 'admin-1', role: 'admin' }
const sessions = [
  ['anonymous', anonymous],
  ['author', author],
  ['admin', admin],
] as const

function returnsNull(): boolean
function returnsNull(): boolean | null {
  return null
}

function returnsUndefined(): boolean
function returnsUndefined(): boolean | undefined {
  return undefined
}

function returnsFilter(): boolean
function returnsFilter(): boolean | { title: { equals: string } } {
  return { title: { equals: 'scoped' } }
}

const ruleFailure = new Error('rule failed')

function throws(): never {
  throw ruleFailure
}

const isAdmin = ({ session }: { session: Session | null }): boolean => session?.role === 'admin'

const ownsRow: FieldAccessControl = ({ session, item }) => item?.ownerId === session?.userId

let countedReads = 0
let hiddenReads = 0

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Memo: {
      fields: {
        plain: text(),
        open: text({ access: { read: () => true, create: () => true, update: () => true } }),
        closed: text({ access: { read: () => false, create: () => false, update: () => false } }),
        adminOnly: text({ access: { read: isAdmin, create: isAdmin, update: isAdmin } }),
        ownerDirect: text({
          access: {
            read: ({ item }) => item.ownerId === 'owner',
            update: ({ item }) => item.ownerId === 'owner',
          },
        }),
        ownerOptional: text({ access: { read: ownsRow, create: ownsRow, update: ownsRow } }),
        payload: text({
          access: {
            create: ({ inputData }) => inputData?.plain !== 'forbidden',
            update: ({ inputData }) => inputData?.plain !== 'forbidden',
          },
        }),
        nullish: text({
          access: { read: returnsNull, create: returnsUndefined, update: returnsNull },
        }),
        filtered: text({ access: { read: returnsFilter } }),
        throwing: text({ access: { read: throws, create: throws, update: throws } }),
        hookOnly: text({ access: { write: 'hooks' } }),
        unfilterable: text({ isFilterable: false }),
        computed: virtual({ type: 'string', hooks: { resolveOutput: () => 'computed' } }),
        ownerId: text(),
        notes: relationship({ ref: 'Note.memo', many: true }),
      },
      access: {
        operation: {
          query: () => true,
          create: () => true,
          update: () => true,
          delete: () => true,
        },
      },
    },
    Note: {
      fields: { label: text(), memo: relationship({ ref: 'Memo.notes' }) },
      access: { operation: { query: () => false } },
    },
    NoRule: { fields: { title: text() } },
    Open: {
      fields: { title: text() },
      access: {
        operation: {
          query: () => true,
          create: () => true,
          update: () => true,
          delete: () => true,
        },
      },
    },
    Closed: {
      fields: { title: text() },
      access: {
        operation: {
          query: () => false,
          create: () => false,
          update: () => false,
          delete: () => false,
        },
      },
    },
    Nullish: {
      fields: { title: text() },
      access: {
        operation: {
          query: returnsNull,
          create: returnsUndefined,
          update: returnsUndefined,
          delete: returnsNull,
        },
      },
    },
    Filtered: {
      fields: { title: text() },
      access: {
        operation: {
          query: () => ({ title: { equals: 'scoped' } }),
          create: () => ({ title: { equals: 'scoped' } }),
          update: () => ({ title: { equals: 'scoped' } }),
          delete: () => ({ title: { equals: 'scoped' } }),
        },
      },
    },
    SessionKeyed: {
      fields: { title: text() },
      access: {
        operation: { query: isAdmin, create: isAdmin, update: isAdmin, delete: isAdmin },
      },
    },
    RowReading: {
      fields: { title: text(), ownerId: text() },
      access: {
        operation: {
          query: () => true,
          create: ({ session, item }) => item?.ownerId === session?.userId,
          update: ({ session, item }) => item?.ownerId === session?.userId,
          delete: ({ session, item }) => item?.ownerId === session?.userId,
        },
      },
    },
    Throwing: {
      fields: { title: text() },
      access: { operation: { query: throws, create: throws, update: throws, delete: throws } },
    },
    Counted: {
      fields: {
        title: text({
          access: {
            read: () => {
              countedReads += 1
              return true
            },
          },
        }),
      },
      access: { operation: { query: () => true } },
    },
    Hidden: {
      fields: {
        title: text({
          access: {
            read: () => {
              hiddenReads += 1
              return true
            },
          },
        }),
      },
      access: { operation: { query: () => false, create: () => true } },
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

afterEach(() => {
  vi.restoreAllMocks()
})

function quietly(): void {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
}

async function vocabularyOf(context: AnyStackContext, listKey: string): Promise<SessionVocabulary> {
  const vocabulary = await engineContextOf(context)._sessionVocabulary?.(listKey)
  if (vocabulary === undefined || vocabulary === null) {
    throw new Error(`No session vocabulary for "${listKey}"`)
  }
  return vocabulary
}

async function fieldOf(
  context: AnyStackContext,
  listKey: string,
  fieldName: string,
): Promise<FieldVocabulary> {
  const field = (await vocabularyOf(context, listKey)).fields.get(fieldName)
  if (field === undefined) throw new Error(`No entry for "${listKey}.${fieldName}"`)
  return field
}

async function memoField(session: Session | null, fieldName: string): Promise<FieldVocabulary> {
  return await fieldOf(database.context(session), 'Memo', fieldName)
}

async function operationsOf(
  context: AnyStackContext,
  listKey: string,
): Promise<SessionVocabulary['operations']> {
  return (await vocabularyOf(context, listKey)).operations
}

function everyOperation(answer: AccessAnswer): SessionVocabulary['operations'] {
  return { query: answer, create: answer, update: answer, delete: answer }
}

describe('the session vocabulary', () => {
  describe('field read, create and update by rule shape', () => {
    test.each<[string, AccessAnswer, AccessAnswer, AccessAnswer]>([
      ['plain', 'allow', 'allow', 'allow'],
      ['open', 'allow', 'allow', 'allow'],
      ['closed', 'deny', 'deny', 'deny'],
      ['ownerDirect', 'row-dependent', 'allow', 'row-dependent'],
      ['ownerOptional', 'row-dependent', 'row-dependent', 'row-dependent'],
      ['payload', 'allow', 'row-dependent', 'row-dependent'],
      ['nullish', 'deny', 'deny', 'deny'],
      ['hookOnly', 'allow', 'deny', 'deny'],
    ])(
      '%s answers read %s, create %s, update %s for every session',
      async (fieldName, read, create, update) => {
        for (const [, session] of sessions) {
          expect(await memoField(session, fieldName)).toMatchObject({ read, create, update })
        }
      },
      BOOT,
    )

    test(
      'a session-dependent rule allows the session it names and denies the others',
      async () => {
        const allowed = { read: 'allow', create: 'allow', update: 'allow' }
        const denied = { read: 'deny', create: 'deny', update: 'deny' }
        expect(await memoField(admin, 'adminOnly')).toMatchObject(allowed)
        expect(await memoField(author, 'adminOnly')).toMatchObject(denied)
        expect(await memoField(anonymous, 'adminOnly')).toMatchObject(denied)
      },
      BOOT,
    )

    test(
      'a write rule that optional-chains the row is row-dependent, and so is a create rule sharing it (#2383)',
      async () => {
        const field = await memoField(author, 'ownerOptional')
        expect(field.update).toBe('row-dependent')
        expect(field.create).toBe('row-dependent')
      },
      BOOT,
    )

    test(
      'a read rule returning a filter denies and is logged',
      async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        expect((await memoField(author, 'filtered')).read).toBe('deny')
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('Memo.filtered'),
          expect.anything(),
        )
      },
      BOOT,
    )

    test(
      'a throwing rule denies every operation and the error is logged',
      async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        expect(await memoField(author, 'throwing')).toMatchObject({
          read: 'deny',
          create: 'deny',
          update: 'deny',
        })
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('Memo.throwing'), ruleFailure)
      },
      BOOT,
    )

    test(
      'sudo allows every field except the writes of a hook-only one',
      async () => {
        const vocabulary = await vocabularyOf(database.context(anonymous).sudo(), 'Memo')
        for (const [fieldName, field] of vocabulary.fields) {
          const write = fieldName === 'hookOnly' ? 'deny' : 'allow'
          expect(field).toMatchObject({ read: 'allow', create: write, update: write })
        }
      },
      BOOT,
    )

    test(
      'a relationship names its target list and nothing about the target’s access',
      async () => {
        const notes = await memoField(author, 'notes')
        expect(notes.relationship).toEqual({ targetList: 'Note' })
        expect((await memoField(author, 'plain')).relationship).toBeNull()
      },
      BOOT,
    )

    test(
      'an unknown list has no vocabulary',
      async () => {
        const context = engineContextOf(database.context(author))
        expect(await context._sessionVocabulary?.('Nope')).toBeNull()
        expect(await context._sessionVocabulary?.('constructor')).toBeNull()
      },
      BOOT,
    )
  })

  describe('list operations by rule shape', () => {
    test.each<[string, SessionVocabulary['operations']]>([
      ['NoRule', everyOperation('deny')],
      ['Open', everyOperation('allow')],
      ['Closed', everyOperation('deny')],
      ['Nullish', everyOperation('deny')],
      ['Filtered', { query: 'allow', create: 'deny', update: 'allow', delete: 'allow' }],
      [
        'RowReading',
        {
          query: 'allow',
          create: 'row-dependent',
          update: 'row-dependent',
          delete: 'row-dependent',
        },
      ],
    ])(
      '%s answers the same for every session',
      async (listKey, expected) => {
        for (const [, session] of sessions) {
          expect(await operationsOf(database.context(session), listKey)).toEqual(expected)
        }
      },
      BOOT,
    )

    test(
      'an operation rule returning null or undefined denies (#2382)',
      async () => {
        expect(await operationsOf(database.context(admin), 'Nullish')).toEqual(
          everyOperation('deny'),
        )
      },
      BOOT,
    )

    test(
      'a session-dependent rule allows the session it names and denies the others',
      async () => {
        expect(await operationsOf(database.context(admin), 'SessionKeyed')).toEqual(
          everyOperation('allow'),
        )
        expect(await operationsOf(database.context(author), 'SessionKeyed')).toEqual(
          everyOperation('deny'),
        )
        expect(await operationsOf(database.context(anonymous), 'SessionKeyed')).toEqual(
          everyOperation('deny'),
        )
      },
      BOOT,
    )

    test(
      'a throwing rule denies and the error is logged',
      async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        expect(await operationsOf(database.context(author), 'Throwing')).toEqual(
          everyOperation('deny'),
        )
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('Throwing.query'), ruleFailure)
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('Throwing.delete'), ruleFailure)
      },
      BOOT,
    )

    test.each(['NoRule', 'Closed', 'Nullish', 'Filtered', 'RowReading', 'Throwing'])(
      'sudo allows every operation on %s',
      async (listKey) => {
        const context = database.context(anonymous).sudo()
        expect(await operationsOf(context, listKey)).toEqual(everyOperation('allow'))
      },
      BOOT,
    )
  })

  describe('filterable and sortable', () => {
    test(
      'a field read as allow, with a Filter spec and an order, is both',
      async () => {
        expect(await memoField(author, 'plain')).toMatchObject({ filterable: true, sortable: true })
        expect(await memoField(author, 'open')).toMatchObject({ filterable: true, sortable: true })
      },
      BOOT,
    )

    test.each(['closed', 'ownerDirect', 'ownerOptional', 'nullish'])(
      '%s, which is not read as allow, is neither',
      async (fieldName) => {
        expect(await memoField(author, fieldName)).toMatchObject({
          filterable: false,
          sortable: false,
        })
      },
      BOOT,
    )

    test(
      'a session-dependent read rule is filterable and sortable only for the session it allows',
      async () => {
        expect(await memoField(admin, 'adminOnly')).toMatchObject({
          filterable: true,
          sortable: true,
        })
        expect(await memoField(author, 'adminOnly')).toMatchObject({
          filterable: false,
          sortable: false,
        })
      },
      BOOT,
    )

    test(
      'isFilterable: false is neither filterable nor sortable, though readable',
      async () => {
        expect(await memoField(author, 'unfilterable')).toMatchObject({
          read: 'allow',
          filterable: false,
          sortable: false,
        })
      },
      BOOT,
    )

    test(
      'a virtual field has no Filter spec and no order',
      async () => {
        expect(await memoField(author, 'computed')).toMatchObject({
          read: 'allow',
          filterable: false,
          sortable: false,
        })
      },
      BOOT,
    )

    test(
      'a throwing read rule is neither',
      async () => {
        quietly()
        expect(await memoField(author, 'throwing')).toMatchObject({
          filterable: false,
          sortable: false,
        })
      },
      BOOT,
    )

    test(
      'a list whose query is denied has nothing filterable or sortable and asks no read rule',
      async () => {
        hiddenReads = 0
        const vocabulary = await vocabularyOf(database.context(admin), 'Hidden')
        expect(vocabulary.operations.query).toBe('deny')
        expect(vocabulary.fields.get('title')).toMatchObject({
          read: 'deny',
          filterable: false,
          sortable: false,
        })
        expect(hiddenReads).toBe(0)
      },
      BOOT,
    )

    test(
      'sudo makes every readable field with a Filter spec and an order both',
      async () => {
        const context = database.context(anonymous).sudo()
        expect(await fieldOf(context, 'Memo', 'closed')).toMatchObject({
          filterable: true,
          sortable: true,
        })
        expect(await fieldOf(context, 'Memo', 'unfilterable')).toMatchObject({
          filterable: false,
          sortable: false,
        })
      },
      BOOT,
    )
  })

  describe('lifetime', () => {
    test(
      'a rule is asked once per context, and again on a context derived with withSession()',
      async () => {
        countedReads = 0
        const context = database.context(author)
        await vocabularyOf(context, 'Counted')
        await vocabularyOf(context, 'Counted')
        await Promise.all([vocabularyOf(context, 'Counted'), vocabularyOf(context, 'Counted')])
        expect(countedReads).toBe(1)

        await vocabularyOf(context.withSession(admin), 'Counted')
        expect(countedReads).toBe(2)
      },
      BOOT,
    )

    test(
      'a derived context resolves its own answer for its own session',
      async () => {
        const context = database.context(author)
        expect((await fieldOf(context, 'Memo', 'adminOnly')).read).toBe('deny')
        expect((await fieldOf(context.withSession(admin), 'Memo', 'adminOnly')).read).toBe('allow')
        expect((await fieldOf(context.sudo(), 'Memo', 'closed')).read).toBe('allow')
        expect((await fieldOf(context, 'Memo', 'closed')).read).toBe('deny')
      },
      BOOT,
    )

    test(
      'a transaction context resolves its own answer',
      async () => {
        countedReads = 0
        const context = database.context(author)
        await vocabularyOf(context, 'Counted')
        await context.transaction(async (tx) => {
          await vocabularyOf(tx, 'Counted')
        })
        expect(countedReads).toBe(2)
      },
      BOOT,
    )
  })
})
