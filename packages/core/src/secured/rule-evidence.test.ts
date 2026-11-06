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
        hasPrivateRemark: checkbox(),
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
        fromColumn: text({ access: { read: ({ item }) => item.hasPrivateRemark !== true } }),
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
      access: {
        operation: { ...open, update: ({ session }) => session?.userId !== 'read-only' },
      },
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
      hooks: {
        afterOperation: async (args) => {
          if (args.operation === 'delete' || args.item.private !== true) return
          const recorded = await args.context.db.Dossier.update({
            where: { id: String(args.item.dossierId) },
            data: { hasPrivateRemark: true },
          })
          if (recorded === null) throw new ValidationError(['The dossier could not be marked.'])
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
      return ['fromOwnRead', 'fromInclude', 'fromColumn', 'fromEvidence'].filter(
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
          fromColumn: 'x',
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
      'a column on the row answers the same for every session',
      async () => {
        expect(await fields('stranger')).not.toContain('fromColumn')
        expect(await fields('author')).not.toContain('fromColumn')
      },
      BOOT,
    )

    test(
      'a column survives every read shape, the relation included',
      async () => {
        const context = db.context({ userId: 'stranger' })
        const bare = await context.db.Dossier.first()
        const counted = await context.db.Dossier.include('remarks', (rows) => rows.count()).first()

        expect(bare).not.toHaveProperty('fromColumn')
        expect(counted).not.toHaveProperty('fromColumn')
      },
      BOOT,
    )

    test(
      'a write that cannot record the fact fails rather than leaving it stale',
      async () => {
        const context = db.context({ userId: 'read-only' })
        const dossier = await context.sudo().db.Dossier.create({ data: { name: 'e' } })

        await expect(
          context.db.Remark.create({
            data: {
              body: 'unrecorded',
              author: 'read-only',
              private: true,
              dossier: { connect: { id: dossier!.id } },
            },
          }),
        ).rejects.toThrow('could not be marked')

        const remarks = await context
          .sudo()
          .db.Remark.where({ body: { equals: 'unrecorded' } })
          .all()
        expect(remarks).toEqual([])
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
})
