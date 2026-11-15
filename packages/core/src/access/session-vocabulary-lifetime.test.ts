import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import type { AccessContext, Session } from './types.js'
import type { AccessAnswer } from './session-vocabulary.js'
import { engineContextOf, type AnyStackContext } from '../context/engine-context.js'
import { processLifetimeContext } from '../context/process-lifetime.js'
import { checkbox, text, virtual } from '../fields/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'

const BOOT = 120_000
const HANG = 5_000

let gateAsks = 0
let promotionAsks = 0

const openOperations = {
  query: () => true,
  create: () => true,
  update: () => true,
  delete: () => true,
}

async function signupOpen(context: AccessContext): Promise<boolean> {
  gateAsks += 1
  const open = await context.db.Toggle.where({ open: { equals: true } }).all()
  return open.length > 0
}

async function isPromoted(session: Session | null, context: AccessContext): Promise<boolean> {
  promotionAsks += 1
  const memberId = session?.memberId
  if (typeof memberId !== 'string') return false
  const member = await context.db.Member.where({ id: { equals: memberId } }).first()
  return member?.role === 'admin'
}

async function peekLooped(context: AccessContext): Promise<string> {
  const answer = await context._sessionVocabularyQuestions?.('Looped')?.operation('query')
  return answer ?? 'none'
}

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Toggle: {
      fields: { open: checkbox() },
      access: { operation: openOperations },
    },
    Gated: {
      fields: { title: text() },
      access: {
        operation: { query: () => true, create: async ({ context }) => await signupOpen(context) },
      },
    },
    Member: {
      fields: { name: text({ validation: { isRequired: true } }), role: text() },
      access: { operation: openOperations },
    },
    Promoted: {
      fields: { title: text() },
      access: {
        operation: {
          query: () => true,
          create: async ({ session, context }) => await isPromoted(session, context),
        },
      },
    },
    Locked: {
      fields: { title: text() },
      access: { operation: { query: () => true, create: () => true, update: () => false } },
    },
    Reader: {
      fields: {
        title: text(),
        peek: virtual({
          type: 'string',
          hooks: { resolveOutput: async ({ context }) => await peekLooped(context) },
        }),
      },
      access: { operation: openOperations },
    },
    Looped: {
      fields: { title: text() },
      access: {
        operation: {
          query: async ({ context }) => (await context.db.Reader.all()).length > 0,
        },
      },
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

beforeEach(async () => {
  gateAsks = 0
  promotionAsks = 0
  vi.restoreAllMocks()
  const sudo = database.context(null).sudo()
  for (const row of await sudo.db.Toggle.all())
    await sudo.db.Toggle.delete({ where: { id: row.id } })
})

async function operationOf(
  context: AnyStackContext | AccessContext,
  listKey: string,
  operation: 'query' | 'create',
): Promise<AccessAnswer> {
  const engine = 'ormHandle' in context ? context : engineContextOf(context)
  const vocabulary = await engine._sessionVocabulary?.(listKey)
  if (vocabulary === undefined || vocabulary === null) {
    throw new Error(`No session vocabulary for "${listKey}"`)
  }
  return vocabulary.operations[operation]
}

async function openSignup(): Promise<void> {
  await database
    .context(null)
    .sudo()
    .db.Toggle.create({ data: { open: true } })
}

async function newMember(role: string): Promise<{ id: string; session: Session }> {
  const member = await database
    .context(null)
    .sudo()
    .db.Member.create({ data: { name: 'm', role } })
  if (member === null || typeof member.id !== 'string') throw new Error('member not created')
  return { id: member.id, session: { memberId: member.id } }
}

function withinHang<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const hung = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('the vocabulary waited on itself')), HANG)
  })
  return Promise.race([pending, hung]).finally(() => clearTimeout(timer))
}

describe('the process-lifetime context', () => {
  test(
    'answers a data-dependent rule afresh on every ask',
    async () => {
      const raw = processLifetimeContext(database.context(null))

      expect(await operationOf(raw, 'Gated', 'create')).toBe('deny')
      await openSignup()
      expect(await operationOf(raw, 'Gated', 'create')).toBe('allow')
      expect(gateAsks).toBe(2)
    },
    BOOT,
  )

  test(
    'a request context keeps its answer until it writes',
    async () => {
      const context = database.context(null)

      expect(await operationOf(context, 'Gated', 'create')).toBe('deny')
      await openSignup()
      expect(await operationOf(context, 'Gated', 'create')).toBe('deny')
      expect(gateAsks).toBe(1)
    },
    BOOT,
  )
})

describe('a write through a context', () => {
  test(
    'promoting a role inside a transaction is reflected on the next ask, there and after commit',
    async () => {
      const { id, session } = await newMember('member')
      const context = database.context(session)

      expect(await operationOf(context, 'Promoted', 'create')).toBe('deny')
      await context.transaction(async (tx) => {
        expect(await operationOf(tx, 'Promoted', 'create')).toBe('deny')
        expect(await tx.db.Member.update({ where: { id }, data: { role: 'admin' } })).not.toBeNull()
        expect(await operationOf(tx, 'Promoted', 'create')).toBe('allow')
      })
      expect(await operationOf(context, 'Promoted', 'create')).toBe('allow')
    },
    BOOT,
  )

  test(
    'a write outside a transaction clears the memo of the context it went through',
    async () => {
      const { id, session } = await newMember('member')
      const context = database.context(session)

      expect(await operationOf(context, 'Promoted', 'create')).toBe('deny')
      await context.db.Member.update({ where: { id }, data: { role: 'admin' } })
      expect(await operationOf(context, 'Promoted', 'create')).toBe('allow')
    },
    BOOT,
  )

  test(
    'a write through sudo() clears the memo of the context sudo() was called on',
    async () => {
      const { id, session } = await newMember('member')
      const context = database.context(session)

      expect(await operationOf(context, 'Promoted', 'create')).toBe('deny')
      await context.sudo().db.Member.update({ where: { id }, data: { role: 'admin' } })
      expect(await operationOf(context, 'Promoted', 'create')).toBe('allow')
    },
    BOOT,
  )

  test(
    'a denied write invalidates nothing',
    async () => {
      const { session } = await newMember('member')
      const context = database.context(session)
      const locked = await database.context(null).db.Locked.create({ data: { title: 'x' } })
      if (locked === null) throw new Error('locked row not created')

      await operationOf(context, 'Promoted', 'create')
      expect(
        await context.db.Locked.update({ where: { id: locked.id }, data: { title: 'y' } }),
      ).toBeNull()
      await operationOf(context, 'Promoted', 'create')
      expect(promotionAsks).toBe(1)
    },
    BOOT,
  )

  test(
    'a failed write invalidates nothing',
    async () => {
      const { session } = await newMember('member')
      const context = database.context(session)

      await operationOf(context, 'Promoted', 'create')
      await expect(context.db.Member.create({ data: { role: 'admin' } })).rejects.toThrow()
      await operationOf(context, 'Promoted', 'create')
      expect(promotionAsks).toBe(1)
    },
    BOOT,
  )

  test(
    'a transaction that rolls back leaves the outer memo as it was',
    async () => {
      const { id, session } = await newMember('member')
      const context = database.context(session)

      await operationOf(context, 'Promoted', 'create')
      await expect(
        context.transaction(async (tx) => {
          await tx.db.Member.update({ where: { id }, data: { role: 'admin' } })
          throw new Error('roll back')
        }),
      ).rejects.toThrow('roll back')
      expect(await operationOf(context, 'Promoted', 'create')).toBe('deny')
      expect(promotionAsks).toBe(1)
    },
    BOOT,
  )
})

describe('a resolveOutput hook asking the answer its own read is resolving', () => {
  test(
    'gets an answer instead of waiting on itself',
    async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      await withinHang(database.context(null).db.Reader.create({ data: { title: 'r' } }))
      const context = database.context(null)

      expect(await withinHang(operationOf(context, 'Looped', 'query'))).toBe('allow')
    },
    BOOT,
  )

  test(
    'outside that resolution, shares the answer its read context settled',
    async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      await withinHang(database.context(null).db.Reader.create({ data: { title: 'r' } }))
      const context = database.context(null)

      const answer = await operationOf(context, 'Looped', 'query')
      const rows = await context.db.Reader.all()
      expect(rows.map((row) => row.peek)).toEqual(rows.map(() => answer))
    },
    BOOT,
  )
})
