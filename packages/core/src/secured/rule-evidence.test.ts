import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { Session } from '../access/types.js'
import type { OpenSaasConfig } from '../config/types.js'
import { checkbox, relationship, text, virtual } from '../fields/index.js'
import { ValidationError } from '../hooks/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'

const BOOT = 120_000

const open = { query: () => true, create: () => true, update: () => true, delete: () => true }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function banned(value: unknown): unknown {
  return isRecord(value) ? value.banned : undefined
}

const visibleToOwner = ({ session }: { session: Session | null }) => ({
  owner: { equals: typeof session?.userId === 'string' ? session.userId : '' },
})

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    // A rule that catches the poison: it reads the row, whatever it answers
    // without one.
    Vault: {
      fields: { name: text(), secrets: relationship({ ref: 'Secret.vault', many: true }) },
      access: { operation: open },
    },
    Secret: {
      fields: {
        title: text(),
        isPrivate: checkbox(),
        vault: relationship({ ref: 'Vault.secrets' }),
        rethrown: text({
          access: {
            read: ({ item }) => {
              try {
                return item.isPrivate !== true
              } catch {
                throw new Error('this rule rethrows what it caught')
              }
            },
          },
        }),
        body: text({
          access: {
            read: ({ item }) => {
              try {
                return item.isPrivate !== true
              } catch {
                return true
              }
            },
          },
        }),
      },
      access: { operation: open },
    },

    // A to-one the related list's Access Filter can scope away.
    Person: {
      fields: { owner: text(), banned: checkbox() },
      access: { operation: { ...open, query: visibleToOwner } },
    },
    Claim: {
      fields: {
        name: text(),
        owner: relationship({ ref: 'Person' }),
        detail: text({ access: { read: ({ item }) => !banned(item.owner) } }),
        ownerState: virtual({
          type: 'string',
          needs: ['owner'],
          hooks: {
            resolveOutput: ({ item }) => (item.owner === null ? 'null' : typeof item.owner),
          },
        }),
      },
      access: { operation: open },
    },

    // The inverse side of a one-to-one: no column to tell hidden from empty.
    Badge: {
      fields: {
        owner: text(),
        banned: checkbox(),
        holder: relationship({ ref: 'Holder.badge' }),
      },
      access: { operation: { ...open, query: visibleToOwner } },
    },
    Holder: {
      fields: {
        name: text(),
        badge: relationship({ ref: 'Badge.holder' }),
        detail: text({ access: { read: ({ item }) => !banned(item.badge) } }),
      },
      access: { operation: open },
    },
    OpenBadge: {
      fields: {
        banned: checkbox(),
        holder: relationship({ ref: 'OpenHolder.badge' }),
      },
      access: { operation: open },
    },
    OpenHolder: {
      fields: {
        name: text(),
        badge: relationship({ ref: 'OpenBadge.holder' }),
        detail: text({ access: { read: ({ item }) => !banned(item.badge) } }),
      },
      access: { operation: open },
    },

    // The remedies the docs offer, on a related list the session cannot wholly
    // see: remarks are public, or visible only to their author.
    Dossier: {
      fields: {
        name: text(),
        remarks: relationship({ ref: 'Remark.dossier', many: true }),
        clearances: relationship({ ref: 'Clearance.dossier', many: true }),
        fromOwnRead: text({
          access: {
            read: async ({ item, context }) => {
              const { hidden } = await context.db.Remark.where({
                dossierId: { equals: String(item.id) },
                private: { equals: true },
              }).aggregate((aggregate) => ({ hidden: aggregate.count() }))
              return hidden === 0
            },
          },
        }),
        fromInclude: text({
          access: {
            read: ({ item }) =>
              Array.isArray(item.remarks) &&
              item.remarks.every((remark: unknown) => isRecord(remark) && remark.private !== true),
          },
        }),
        fromEvidence: text({
          access: {
            read: async ({ session, item, context }) => {
              const userId = session?.userId
              if (typeof userId !== 'string') return false
              const clearance = await context.db.Clearance.where({
                dossierId: { equals: String(item.id) },
                userId: { equals: userId },
              }).first()
              return clearance !== null
            },
          },
        }),
      },
      access: { operation: open },
    },
    Folder: {
      fields: {
        name: text(),
        leaves: relationship({ ref: 'Leaf.folder', many: true }),
      },
      access: {
        operation: { ...open, query: () => ({ leaves: { none: { private: { equals: true } } } }) },
      },
    },
    Leaf: {
      fields: {
        author: text(),
        private: checkbox(),
        folder: relationship({ ref: 'Folder.leaves' }),
      },
      access: {
        operation: {
          ...open,
          query: ({ session }) => ({
            OR: [
              { private: { equals: false } },
              { author: { equals: typeof session?.userId === 'string' ? session.userId : '' } },
            ],
          }),
        },
      },
    },
    Remark: {
      fields: {
        body: text(),
        author: text(),
        private: checkbox(),
        dossier: relationship({ ref: 'Dossier.remarks' }),
      },
      access: {
        operation: {
          ...open,
          query: ({ session }) => ({
            OR: [
              { private: { equals: false } },
              { author: { equals: typeof session?.userId === 'string' ? session.userId : '' } },
            ],
          }),
        },
      },
    },
    // The column shape exactly as `access-control.md` documents it.
    Ticket: {
      fields: {
        name: text(),
        hasPrivateNote: checkbox({
          access: { update: ({ inputData }) => inputData?.hasPrivateNote === true },
        }),
        summary: text({ access: { read: ({ item }) => item.hasPrivateNote !== true } }),
        notes: relationship({ ref: 'Note.ticket', many: true }),
      },
      access: {
        operation: { ...open, update: ({ session }) => session?.userId !== 'read-only' },
      },
    },
    Note: {
      fields: {
        body: text(),
        author: text(),
        private: checkbox(),
        ticket: relationship({ ref: 'Ticket.notes' }),
      },
      access: {
        operation: {
          ...open,
          query: ({ session }) => ({
            OR: [
              { private: { equals: false } },
              { author: { equals: typeof session?.userId === 'string' ? session.userId : '' } },
            ],
          }),
        },
      },
      hooks: {
        afterOperation: async (args) => {
          if (args.operation === 'delete' || args.item.private !== true) return
          if (args.item.ticketId === null) return
          const marked = await args.context.db.Ticket.update({
            where: { id: String(args.item.ticketId) },
            data: { hasPrivateNote: true },
          })
          if (marked === null) throw new ValidationError(['The ticket could not be marked.'])
        },
      },
    },
    Clearance: {
      fields: { userId: text(), dossier: relationship({ ref: 'Dossier.clearances' }) },
      access: {
        operation: {
          ...open,
          query: ({ session }) => ({
            userId: { equals: typeof session?.userId === 'string' ? session.userId : '' },
          }),
        },
      },
    },
  },
}

describe('what a read rule can rest on', () => {
  let db: TestDatabase

  beforeAll(async () => {
    db = await createTestDatabase(config)
  }, BOOT)

  afterAll(async () => {
    await db?.close()
  })

  beforeEach(async () => {
    await db.truncate()
  })

  describe('a rule that catches the poison on `item`', () => {
    beforeEach(async () => {
      const admin = db.context({}).sudo()
      const vault = await admin.db.Vault.create({ data: { name: 'v' } })
      for (const [title, isPrivate] of [
        ['open', false],
        ['closed', true],
      ] as const) {
        await admin.db.Secret.create({
          data: {
            title,
            isPrivate,
            body: `${title}-TOPSECRET`,
            vault: { connect: { id: vault!.id } },
          },
        })
      }
    })

    test(
      'a select still reads the level at full width',
      async () => {
        const rows = await db
          .context({})
          .db.Secret.orderBy({ title: 'desc' })
          .select('title', 'body')
          .all()

        expect(rows).toEqual([
          expect.objectContaining({ title: 'open', body: 'open-TOPSECRET' }),
          expect.not.objectContaining({ body: expect.anything() }),
        ])
      },
      BOOT,
    )

    test(
      'a rule that rethrows something else is row-dependent too',
      async () => {
        const rows = await db
          .context({})
          .db.Secret.orderBy({ title: 'desc' })
          .select('title', 'rethrown')
          .all()

        expect(rows.map((row) => row.title)).toEqual(['open', 'closed'])
      },
      BOOT,
    )

    test(
      'a where cannot name it',
      async () => {
        await expect(
          db
            .context({})
            .db.Secret.where({ body: { contains: 'TOPSECRET' } })
            .all(),
        ).rejects.toThrow(/body/)
      },
      BOOT,
    )

    test(
      'a nested select cannot narrow past it',
      async () => {
        const [vault] = await db
          .context({})
          .db.Vault.include('secrets', (rows) => rows.orderBy({ title: 'desc' }).select('body'))
          .all()

        expect(vault.secrets).toEqual([
          expect.objectContaining({ body: 'open-TOPSECRET' }),
          expect.not.objectContaining({ body: expect.anything() }),
        ])
      },
      BOOT,
    )

    test(
      'a combine rows branch cannot narrow past it',
      async () => {
        const [vault] = await db
          .context({})
          .db.Vault.include('secrets', (rows) =>
            rows.combine({
              rows: rows.orderBy({ title: 'desc' }).select('body'),
              total: rows.count(),
            }),
          )
          .all()

        expect(Reflect.get(vault, 'secrets')).toEqual({
          total: 2,
          rows: [
            expect.objectContaining({ body: 'open-TOPSECRET' }),
            expect.not.objectContaining({ body: expect.anything() }),
          ],
        })
      },
      BOOT,
    )
  })

  describe('a to-one the related list scopes away', () => {
    const detailFor = async (userId: string, include: boolean) => {
      const base = db.context({ userId }).db.Claim.orderBy({ name: 'asc' })
      const rows = await (include ? base.include('owner') : base).all()
      return rows.map((row) => 'detail' in row)
    }

    beforeEach(async () => {
      const admin = db.context({}).sudo()
      const clean = await admin.db.Person.create({ data: { owner: 'ann', banned: false } })
      const flagged = await admin.db.Person.create({ data: { owner: 'ann', banned: true } })
      for (const [name, person] of [
        ['a-clean', clean],
        ['b-flagged', flagged],
      ] as const) {
        await admin.db.Claim.create({
          data: { name, detail: 'DETAIL', owner: { connect: { id: person!.id } } },
        })
      }
      await admin.db.Claim.create({ data: { name: 'c-ownerless', detail: 'DETAIL' } })
    })

    test(
      'denies a session that cannot see the row, as the bare read does',
      async () => {
        expect(await detailFor('bob', true)).toEqual([false, false, true])
      },
      BOOT,
    )

    test(
      'decides on the row for a session that can see it',
      async () => {
        expect(await detailFor('ann', true)).toEqual([true, false, true])
      },
      BOOT,
    )

    test(
      'a null foreign key is a real answer',
      async () => {
        const rows = await db
          .context({ userId: 'bob' })
          .db.Claim.where({ name: { equals: 'c-ownerless' } })
          .include('owner')
          .all()

        expect(rows[0]).toMatchObject({ owner: null, detail: 'DETAIL' })
      },
      BOOT,
    )

    test(
      'the declared row decides, not the value the caller shaped away',
      async () => {
        const read = (userId: string) =>
          db
            .context({ userId })
            .db.Claim.orderBy({ name: 'asc' })
            .select('name', 'detail', 'ownerState')
            .include('owner', (owner) => owner.where({ owner: { equals: 'nobody' } }))
            .all()

        expect((await read('ann')).map((row) => 'detail' in row)).toEqual([true, false, true])
        expect((await read('bob')).map((row) => 'detail' in row)).toEqual([false, false, true])
      },
      BOOT,
    )

    test(
      'a hook declaring it still reads null (ADR-0058)',
      async () => {
        const rows = await db.context({ userId: 'bob' }).db.Claim.orderBy({ name: 'asc' }).all()

        expect(rows.map((row) => row.ownerState)).toEqual(['null', 'null', 'null'])
      },
      BOOT,
    )
  })

  describe('the inverse side of a one-to-one', () => {
    beforeEach(async () => {
      const admin = db.context({}).sudo()
      const holder = await admin.db.Holder.create({ data: { name: 'a-held', detail: 'DETAIL' } })
      await admin.db.Holder.create({ data: { name: 'b-none', detail: 'DETAIL' } })
      await admin.db.Badge.create({
        data: { owner: 'ann', banned: false, holder: { connect: { id: holder!.id } } },
      })
      await admin.db.OpenHolder.create({ data: { name: 'none', detail: 'DETAIL' } })
    })

    test(
      'denies when the related list could have left the row out, seen or not',
      async () => {
        const read = (userId: string) =>
          db.context({ userId }).db.Holder.orderBy({ name: 'asc' }).include('badge').all()

        expect((await read('bob')).map((row) => 'detail' in row)).toEqual([false, false])
        expect((await read('ann')).map((row) => 'detail' in row)).toEqual([true, false])
      },
      BOOT,
    )

    test(
      'is a real answer where the related list scopes nothing',
      async () => {
        const row = await db.context({}).db.OpenHolder.include('badge').first()

        expect(row).toMatchObject({ badge: null, detail: 'DETAIL' })
      },
      BOOT,
    )
  })

  describe('a rule about rows the session may not be able to see', () => {
    const fields = async (userId: string) => {
      const row = await db.context({ userId }).db.Dossier.include('remarks').first()
      return ['fromOwnRead', 'fromInclude', 'fromEvidence'].filter(
        (key) => row !== null && key in row,
      )
    }

    beforeEach(async () => {
      const admin = db.context({}).sudo()
      const dossier = await admin.db.Dossier.create({
        data: {
          name: 'd',
          fromOwnRead: 'x',
          fromInclude: 'x',
          fromEvidence: 'x',
        },
      })
      const connect = { dossier: { connect: { id: dossier!.id } } }
      await db.context({ userId: 'author' }).db.Remark.create({
        data: { body: 'hidden', author: 'author', private: true, ...connect },
      })
      await admin.db.Clearance.create({ data: { userId: 'cleared', ...connect } })
    })

    test(
      'an own read or an include counts what the session sees, so a stranger passes',
      async () => {
        expect(await fields('stranger')).toEqual(
          expect.arrayContaining(['fromOwnRead', 'fromInclude']),
        )
        expect(await fields('author')).not.toEqual(expect.arrayContaining(['fromOwnRead']))
      },
      BOOT,
    )

    test(
      'a relation predicate in an Access Filter counts what the session sees too',
      async () => {
        const admin = db.context({}).sudo()
        const folder = await admin.db.Folder.create({ data: { name: 'f' } })
        await admin.db.Leaf.create({
          data: { author: 'author', private: true, folder: { connect: { id: folder!.id } } },
        })

        expect(await db.context({ userId: 'stranger' }).db.Folder.all()).toHaveLength(1)
        expect(await db.context({ userId: 'author' }).db.Folder.all()).toHaveLength(0)
      },
      BOOT,
    )

    test(
      'a grant resting on a row the session can see cannot be opened by hiding it',
      async () => {
        expect(await fields('cleared')).toContain('fromEvidence')
        expect(await fields('stranger')).not.toContain('fromEvidence')
        expect(await fields('author')).not.toContain('fromEvidence')
      },
      BOOT,
    )
  })

  describe('a column on the row, as the docs write it', () => {
    let ticketId: string

    const summaryFor = async (userId: string) => {
      const row = await db
        .context({ userId })
        .db.Ticket.where({ id: { equals: ticketId } })
        .first()
      return row?.summary
    }

    beforeEach(async () => {
      const admin = db.context({}).sudo()
      const ticket = await admin.db.Ticket.create({ data: { name: 't', summary: 'SECRET' } })
      ticketId = String(ticket!.id)
      await db.context({ userId: 'author' }).db.Note.create({
        data: {
          body: 'hidden',
          author: 'author',
          private: true,
          ticket: { connect: { id: ticketId } },
        },
      })
    })

    test(
      'answers the same for every session, on every read shape',
      async () => {
        expect(await summaryFor('stranger')).toBeUndefined()
        expect(await summaryFor('author')).toBeUndefined()

        const counted = await db
          .context({ userId: 'stranger' })
          .db.Ticket.include('notes', (rows) => rows.count())
          .first()
        expect(counted).not.toHaveProperty('summary')
      },
      BOOT,
    )

    test.each([
      ['false', false],
      ['null', null],
    ])(
      'a writer clearing the flag with %s is refused and still cannot read the secret',
      async (_, value) => {
        await expect(
          db.context({ userId: 'bob' }).db.Ticket.update({
            where: { id: ticketId },
            data: { hasPrivateNote: value },
          }),
        ).rejects.toThrow(/hasPrivateNote|has private note/i)

        expect(await summaryFor('bob')).toBeUndefined()
      },
      BOOT,
    )

    test(
      'an ordinary write to the row still goes through',
      async () => {
        const updated = await db
          .context({ userId: 'bob' })
          .db.Ticket.update({ where: { id: ticketId }, data: { name: 'renamed' } })

        expect(updated).toMatchObject({ name: 'renamed' })
      },
      BOOT,
    )

    test(
      'an unflagged row reads, so the rule has a row it grants',
      async () => {
        const admin = db.context({}).sudo()
        const clean = await admin.db.Ticket.create({ data: { name: 'c', summary: 'OPEN' } })

        const row = await db
          .context({ userId: 'stranger' })
          .db.Ticket.where({ id: { equals: String(clean!.id) } })
          .first()

        expect(row).toMatchObject({ summary: 'OPEN' })
      },
      BOOT,
    )

    test(
      'a note that goes private later raises it',
      async () => {
        const admin = db.context({}).sudo()
        const clean = await admin.db.Ticket.create({ data: { name: 'c', summary: 'OPEN' } })
        const context = db.context({ userId: 'author' })
        const note = await context.db.Note.create({
          data: {
            body: 'b',
            author: 'author',
            private: false,
            ticket: { connect: { id: String(clean!.id) } },
          },
        })
        await context.db.Note.update({ where: { id: String(note!.id) }, data: { private: true } })

        const row = await context.db.Ticket.where({ id: { equals: String(clean!.id) } }).first()
        expect(row).not.toHaveProperty('summary')
      },
      BOOT,
    )

    test(
      'a private note with no ticket is allowed, and raises it when connected',
      async () => {
        const admin = db.context({}).sudo()
        const clean = await admin.db.Ticket.create({ data: { name: 'c', summary: 'OPEN' } })
        const context = db.context({ userId: 'author' })
        const note = await context.db.Note.create({
          data: { body: 'loose', author: 'author', private: true },
        })
        expect(note).toMatchObject({ body: 'loose' })

        await context.db.Note.update({
          where: { id: String(note!.id) },
          data: { ticket: { connect: { id: String(clean!.id) } } },
        })

        const row = await context.db.Ticket.where({ id: { equals: String(clean!.id) } }).first()
        expect(row).not.toHaveProperty('summary')
      },
      BOOT,
    )

    test(
      'deleting the note leaves it set, stale and safe',
      async () => {
        const admin = db.context({}).sudo()
        const [note] = await admin.db.Note.where({ body: { equals: 'hidden' } }).all()
        await admin.db.Note.delete({ where: { id: String(note.id) } })

        expect(await summaryFor('stranger')).toBeUndefined()
      },
      BOOT,
    )

    test(
      'trusted server code under sudo can lower it',
      async () => {
        await db
          .context({})
          .sudo()
          .db.Ticket.update({ where: { id: ticketId }, data: { hasPrivateNote: false } })

        expect(await summaryFor('stranger')).toBe('SECRET')
      },
      BOOT,
    )

    test(
      'a write that cannot record the fact is refused whole',
      async () => {
        await expect(
          db.context({ userId: 'read-only' }).db.Note.create({
            data: {
              body: 'unrecorded',
              author: 'read-only',
              private: true,
              ticket: { connect: { id: ticketId } },
            },
          }),
        ).rejects.toThrow('could not be marked')

        const notes = await db
          .context({})
          .sudo()
          .db.Note.where({ body: { equals: 'unrecorded' } })
          .all()
        expect(notes).toEqual([])
      },
      BOOT,
    )
  })
})
