import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import type { AccessContext, FieldAccessControl, Session } from './types.js'
import { InvalidFieldAccessResultError } from './errors.js'
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

let filterOnceCalls = 0

function filterOnce(): boolean
function filterOnce(): boolean | { title: { equals: string } } {
  filterOnceCalls += 1
  return filterOnceCalls === 1 ? { title: { equals: 'scoped' } } : true
}

const specFailure = new Error('spec failed')

const brokenSpec = {
  ...text(),
  getFilterSpec: (): never => {
    throw specFailure
  },
}

const openOperations = {
  query: () => true,
  create: () => true,
  update: () => true,
  delete: () => true,
}

const ruleContexts: object[] = []
const hookContexts: object[] = []

async function askSpy(context: AccessContext): Promise<void> {
  hookContexts.push(context)
  await context._sessionVocabulary?.('Spy')
}

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
    FieldFilter: {
      fields: { title: text(), filtered: text({ access: { read: returnsFilter } }) },
      access: { operation: openOperations },
    },
    FilterOnce: {
      fields: { title: text({ access: { read: filterOnce } }) },
      access: { operation: openOperations },
    },
    BrokenSpec: {
      fields: { title: text(), broken: brokenSpec },
      access: { operation: openOperations },
    },
    Account: {
      fields: { name: text(), profile: relationship({ ref: 'Profile.account' }) },
      access: { operation: openOperations },
    },
    Profile: {
      fields: {
        bio: text(),
        account: relationship({ ref: 'Account.profile', db: { foreignKey: true } }),
      },
      access: { operation: openOperations },
    },
    Settings: {
      fields: { siteName: text(), tagline: text() },
      isSingleton: true,
      access: { operation: openOperations },
    },
    Stamped: {
      fields: { title: text() },
      db: { timestamps: true },
      access: { operation: openOperations },
    },
    Spy: {
      fields: { title: text() },
      access: {
        operation: {
          query: ({ context }) => {
            ruleContexts.push(context)
            return true
          },
        },
      },
    },
    Trigger: {
      fields: { title: text() },
      access: { operation: openOperations },
      hooks: {
        beforeOperation: async ({ context }) => await askSpy(context),
        afterTransaction: async ({ context }) => await askSpy(context),
      },
    },
    Probe: {
      fields: {
        title: text(),
        probe: virtual({
          type: 'string',
          hooks: {
            resolveOutput: async ({ context }) => {
              await askSpy(context)
              return 'probed'
            },
          },
        }),
      },
      access: { operation: openOperations },
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
      ['computed', 'allow', 'deny', 'deny'],
      ['notes', 'allow', 'deny', 'deny'],
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
      'the non-owning side of a one-to-one is not writable, and the owning side is',
      async () => {
        const context = database.context(author)
        expect(await fieldOf(context, 'Account', 'profile')).toMatchObject({
          read: 'allow',
          create: 'deny',
          update: 'deny',
        })
        expect(await fieldOf(context, 'Profile', 'account')).toMatchObject({
          read: 'allow',
          create: 'allow',
          update: 'allow',
        })
      },
      BOOT,
    )

    test(
      'a field rule returning a filter denies that field, is logged, and leaves the list answered',
      async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        const vocabulary = await vocabularyOf(database.context(author), 'FieldFilter')
        expect(vocabulary.fields.get('filtered')).toMatchObject({ read: 'deny', filterable: false })
        expect(vocabulary.fields.get('title')).toMatchObject({ read: 'allow', filterable: true })
        expect(vocabulary.operations).toEqual(everyOperation('allow'))
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('FieldFilter.filtered'),
          expect.any(InvalidFieldAccessResultError),
        )
      },
      BOOT,
    )

    test(
      'a contained denial is kept for the context’s life like any other answer',
      async () => {
        quietly()
        filterOnceCalls = 0
        const context = database.context(author)
        expect((await fieldOf(context, 'FilterOnce', 'title')).read).toBe('deny')
        expect((await fieldOf(context, 'FilterOnce', 'title')).read).toBe('deny')
        expect(filterOnceCalls).toBe(1)
        expect((await fieldOf(database.context(author), 'FilterOnce', 'title')).read).toBe('allow')
      },
      BOOT,
    )

    test(
      'a field whose Filter spec throws is not filterable, is logged, and leaves the list answered',
      async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        const vocabulary = await vocabularyOf(database.context(author), 'BrokenSpec')
        expect(vocabulary.fields.get('broken')).toMatchObject({ read: 'allow', filterable: false })
        expect(vocabulary.fields.get('title')).toMatchObject({ filterable: true })
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('BrokenSpec.broken'), specFailure)
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
      'sudo allows every field except the writes of a hook-only, computed, inverse or system one',
      async () => {
        const vocabulary = await vocabularyOf(database.context(anonymous).sudo(), 'Memo')
        for (const [fieldName, field] of vocabulary.fields) {
          const write = ['hookOnly', 'computed', 'notes', 'id'].includes(fieldName)
            ? 'deny'
            : 'allow'
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
  describe('singletons', () => {
    test(
      'a singleton is never deletable, sudo included',
      async () => {
        expect(await operationsOf(database.context(author), 'Settings')).toEqual({
          query: 'allow',
          create: 'allow',
          update: 'allow',
          delete: 'deny',
        })
        expect((await operationsOf(database.context(anonymous).sudo(), 'Settings')).delete).toBe(
          'deny',
        )
      },
      BOOT,
    )

    test(
      'no field of a singleton is filterable or sortable, sudo included',
      async () => {
        for (const context of [database.context(author), database.context(author).sudo()]) {
          const vocabulary = await vocabularyOf(context, 'Settings')
          for (const fieldName of ['siteName', 'tagline', 'id']) {
            expect(vocabulary.fields.get(fieldName)).toMatchObject({
              read: 'allow',
              filterable: false,
              sortable: false,
            })
          }
        }
      },
      BOOT,
    )
  })

  describe('system fields', () => {
    test(
      'id is readable, sortable, not filterable and never writable',
      async () => {
        expect(await memoField(author, 'id')).toEqual({
          read: 'allow',
          create: 'deny',
          update: 'deny',
          filterable: false,
          sortable: true,
          relationship: null,
        })
      },
      BOOT,
    )

    test(
      'automatic timestamps have entries only on a list that has them',
      async () => {
        const context = database.context(author)
        for (const fieldName of ['createdAt', 'updatedAt']) {
          expect(await fieldOf(context, 'Stamped', fieldName)).toEqual({
            read: 'allow',
            create: 'deny',
            update: 'deny',
            filterable: false,
            sortable: true,
            relationship: null,
          })
        }
        const memo = await vocabularyOf(context, 'Memo')
        expect(memo.fields.has('createdAt')).toBe(false)
        expect(memo.fields.has('updatedAt')).toBe(false)
      },
      BOOT,
    )

    test(
      'a list whose query is denied denies its system fields too',
      async () => {
        expect(await fieldOf(database.context(admin), 'Hidden', 'id')).toMatchObject({
          read: 'deny',
          sortable: false,
        })
      },
      BOOT,
    )

    test(
      'sudo reads every system field and writes none',
      async () => {
        expect(
          await fieldOf(database.context(anonymous).sudo(), 'Stamped', 'createdAt'),
        ).toMatchObject({ read: 'allow', create: 'deny', update: 'deny' })
      },
      BOOT,
    )
  })

  describe('the context a rule is asked with', () => {
    function resetSpies(): void {
      ruleContexts.length = 0
      hookContexts.length = 0
    }

    function expectEachHookAskedWithItsOwnContext(hooks: number): void {
      expect(hookContexts).toHaveLength(hooks)
      expect(ruleContexts).toHaveLength(hooks)
      hookContexts.forEach((context, index) => expect(ruleContexts[index]).toBe(context))
    }

    test(
      'a hook inside a write asks the rules with the context bound to the write’s transaction',
      async () => {
        resetSpies()
        expect(
          await database.context(author).db.Trigger.create({ data: { title: 'write' } }),
        ).not.toBeNull()
        expectEachHookAskedWithItsOwnContext(2)
      },
      BOOT,
    )

    test(
      'afterTransaction on a joined write asks the rules with its own context, not the closed transaction’s',
      async () => {
        const context = database.context(author)
        resetSpies()
        await context.transaction(async (tx) => {
          await tx.db.Trigger.create({ data: { title: 'joined' } })
        })
        expectEachHookAskedWithItsOwnContext(2)
      },
      BOOT,
    )

    test(
      'resolveOutput hooks share the read context’s answer: rules are asked once, with that context',
      async () => {
        const context = database.context(author)
        await context.sudo().db.Probe.create({ data: { title: 'probe-rows' } })
        await context.sudo().db.Probe.create({ data: { title: 'probe-rows' } })
        resetSpies()
        expect(await context.db.Probe.where({ title: { equals: 'probe-rows' } }).all()).toEqual([
          expect.objectContaining({ probe: 'probed' }),
          expect.objectContaining({ probe: 'probed' }),
        ])
        expect(hookContexts).toHaveLength(2)
        expect(ruleContexts).toEqual([engineContextOf(context)])
      },
      BOOT,
    )

    test(
      'a detached call answers for the context it was taken from',
      async () => {
        const context = database.context(admin)
        const { _sessionVocabulary } = engineContextOf(context)
        const vocabulary = await _sessionVocabulary?.('Memo')
        expect(vocabulary?.fields.get('adminOnly')?.read).toBe('allow')
      },
      BOOT,
    )
  })
})
