import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import type { Session } from '../access/types.js'
import { relationship, text } from '../fields/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'
import { VacuousAccessFilterError } from '../access/errors.js'

const BOOT = 120_000

let rule: (session: Session | null) => unknown = () => true
let tenantRule: (session: Session | null) => unknown = () => true

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Tenant: {
      fields: {
        name: text(),
        notes: relationship({ ref: 'Note.tenant', many: true }),
      },
      access: { operation: { query: ({ session }) => tenantRule(session) as boolean } },
    },
    Note: {
      fields: {
        orgId: text(),
        body: text(),
        tenant: relationship({ ref: 'Tenant.notes' }),
      },
      access: {
        operation: {
          query: ({ session }) => rule(session) as boolean,
          create: () => true,
          update: ({ session }) => rule(session) as boolean,
          delete: ({ session }) => rule(session) as boolean,
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

let noteId = ''
let tenantId = ''

beforeEach(async () => {
  rule = () => true
  tenantRule = () => true
  await database.truncate()
  const admin = database.context({ orgId: 'o1' }).sudo()
  const tenant = await admin.db.Tenant.create({ data: { name: 't' } })
  if (tenant === null) throw new Error('seed failed')
  tenantId = String(tenant.id)
  const note = await admin.db.Note.create({
    data: { orgId: 'o1', body: 'o1 secret', tenant: { connect: { id: tenant.id } } },
  })
  if (note === null) throw new Error('seed failed')
  noteId = String(note.id)
  await admin.db.Note.create({ data: { orgId: 'o2', body: 'o2 secret' } })
})

const vacuous: Record<string, () => unknown> = {
  'an empty object': () => ({}),
  'an empty AND': () => ({ AND: [] }),
  'an empty object nested in AND': () => ({ AND: [{}, { orgId: { equals: 'o1' } }] }),
  'an empty AND nested in OR': () => ({ OR: [{ AND: [] }, { orgId: { equals: 'o1' } }] }),
  'an empty operator object': () => ({ orgId: {} }),
}

describe('an access rule that constrains nothing is refused', () => {
  for (const [name, make] of Object.entries(vacuous)) {
    test(
      `${name} throws on all, first and aggregate`,
      async () => {
        rule = make
        const { db } = database.context({ orgId: 'o1' })
        await expect(db.Note.all()).rejects.toBeInstanceOf(VacuousAccessFilterError)
        await expect(db.Note.first()).rejects.toBeInstanceOf(VacuousAccessFilterError)
        await expect(
          db.Note.aggregate((aggregate) => ({ total: aggregate.count() })),
        ).rejects.toBeInstanceOf(VacuousAccessFilterError)
      },
      BOOT,
    )
  }

  test(
    'the conditional spread throws anonymously and still scopes with an orgId',
    async () => {
      rule = (session) => ({
        ...(typeof session?.orgId === 'string' ? { orgId: { equals: session.orgId } } : {}),
      })
      await expect(database.context().db.Note.all()).rejects.toBeInstanceOf(
        VacuousAccessFilterError,
      )
      const rows = await database.context({ orgId: 'o1' }).db.Note.all()
      expect(rows.map((row) => row.body)).toEqual(['o1 secret'])
    },
    BOOT,
  )

  test(
    'the error names the path and the fix',
    async () => {
      rule = () => ({ AND: [{}] })
      await expect(database.context().db.Note.all()).rejects.toThrow(/AND\.0.*`true`/s)
    },
    BOOT,
  )

  test(
    'a vacuous related rule throws through a relation predicate and an include',
    async () => {
      tenantRule = () => ({})
      const { db } = database.context({ orgId: 'o1' })
      await expect(
        db.Note.where({ tenant: { is: { name: { equals: 't' } } } }).all(),
      ).rejects.toBeInstanceOf(VacuousAccessFilterError)
      await expect(db.Note.include('tenant').all()).rejects.toBeInstanceOf(VacuousAccessFilterError)
    },
    BOOT,
  )

  test(
    'a vacuous target rule throws on connect',
    async () => {
      tenantRule = () => ({})
      await expect(
        database.context({ orgId: 'o1' }).db.Note.create({
          data: { orgId: 'o1', body: 'x', tenant: { connect: { id: tenantId } } },
        }),
      ).rejects.toBeInstanceOf(VacuousAccessFilterError)
    },
    BOOT,
  )

  test(
    'a vacuous update or delete rule throws instead of matching every row',
    async () => {
      rule = () => ({})
      const { db } = database.context({ orgId: 'o1' })
      await expect(
        db.Note.update({ where: { id: noteId }, data: { body: 'changed' } }),
      ).rejects.toBeInstanceOf(VacuousAccessFilterError)
      await expect(db.Note.delete({ where: { id: noteId } })).rejects.toBeInstanceOf(
        VacuousAccessFilterError,
      )
    },
    BOOT,
  )

  test(
    'true, false, a scoped filter and a caller where({}) behave as before',
    async () => {
      const { db } = database.context({ orgId: 'o1' })
      expect(await db.Note.where({}).all()).toHaveLength(2)
      rule = () => false
      expect(await db.Note.all()).toEqual([])
      rule = () => ({ orgId: { equals: 'o1' } })
      expect(await db.Note.where({}).all()).toHaveLength(1)
    },
    BOOT,
  )
})
