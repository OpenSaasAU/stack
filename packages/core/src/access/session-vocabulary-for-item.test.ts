import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import type { Session } from './types.js'
import type { SessionVocabulary } from './session-vocabulary.js'
import { engineContextOf, type AnyStackContext } from '../context/engine-context.js'
import { text } from '../fields/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'

const BOOT = 120_000

const author: Session = { userId: 'author-1' }

const ruleFailure = new Error('rule failed')

let countedReads = 0
let countedUpdates = 0

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Doc: {
      fields: {
        ownerId: text(),
        ownerDirect: text({
          access: { update: ({ session, item }) => item.ownerId === session?.userId },
        }),
        ownerOptional: text({
          access: {
            read: ({ session, item }) => item?.ownerId === session?.userId,
            update: ({ session, item }) => item?.ownerId === session?.userId,
          },
        }),
        payload: text({ access: { update: ({ inputData }) => inputData?.ownerId !== 'x' } }),
        throwing: text({
          access: {
            update: ({ item }) => {
              if (item.ownerId !== undefined) throw ruleFailure
              return true
            },
          },
        }),
        counted: text({
          access: {
            read: () => {
              countedReads += 1
              return true
            },
            update: () => {
              countedUpdates += 1
              return true
            },
          },
        }),
        hookOnly: text({ access: { write: 'hooks' } }),
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
    Guarded: {
      fields: { ownerId: text(), locked: text(), title: text() },
      access: {
        operation: {
          query: () => true,
          create: () => true,
          update: ({ session, item }) =>
            item?.locked === 'yes' ? false : { ownerId: { equals: String(session?.userId) } },
          delete: ({ session, item }) =>
            item?.locked === 'yes' ? false : { ownerId: { equals: String(session?.userId) } },
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

afterEach(() => {
  vi.restoreAllMocks()
})

async function seed(listKey: 'Doc' | 'Guarded', data: Record<string, string>) {
  const created = await database.context(null).sudo().db[listKey].create({ data })
  if (created === null) throw new Error(`Could not seed ${listKey}`)
  const id: unknown = created.id
  if (typeof id !== 'string' && typeof id !== 'number') throw new Error('No id')
  const row = await database
    .context(null)
    .sudo()
    .db[listKey].where({ id: { equals: id } })
    .first()
  if (row === null) throw new Error(`Could not read ${listKey}`)
  return row
}

function idOf(item: Record<string, unknown>): string | number {
  const id = item.id
  if (typeof id !== 'string' && typeof id !== 'number') throw new Error('No id')
  return id
}

async function forItem(
  context: AnyStackContext,
  listKey: string,
  item: Record<string, unknown>,
): Promise<SessionVocabulary> {
  const vocabulary = await engineContextOf(context)._sessionVocabularyForItem?.(listKey, idOf(item))
  if (vocabulary === undefined || vocabulary === null) {
    throw new Error(`No vocabulary for "${listKey}"`)
  }
  return vocabulary
}

function fieldOf(vocabulary: SessionVocabulary, fieldName: string) {
  const entry = vocabulary.fields.get(fieldName)
  if (entry === undefined) throw new Error(`No entry for "${fieldName}"`)
  return entry
}

describe('the Session vocabulary resolved against one row', () => {
  test('an owner rule allows on the row the session owns and denies on another', async () => {
    const mine = await seed('Doc', { ownerId: 'author-1' })
    const theirs = await seed('Doc', { ownerId: 'someone-else' })
    const context = database.context(author)

    const onMine = await forItem(context, 'Doc', mine)
    const onTheirs = await forItem(context, 'Doc', theirs)

    expect(fieldOf(onMine, 'ownerDirect').update).toBe('allow')
    expect(fieldOf(onTheirs, 'ownerDirect').update).toBe('deny')
  })

  test('an optional-chained item rule resolves read and update for the row', async () => {
    const mine = await seed('Doc', { ownerId: 'author-1' })
    const theirs = await seed('Doc', { ownerId: 'someone-else' })
    const context = database.context(author)

    const onMine = fieldOf(await forItem(context, 'Doc', mine), 'ownerOptional')
    const onTheirs = fieldOf(await forItem(context, 'Doc', theirs), 'ownerOptional')

    expect(onMine).toMatchObject({ read: 'allow', update: 'allow' })
    expect(onTheirs).toMatchObject({ read: 'deny', update: 'deny' })
  })

  test('a rule that reads the payload stays row-dependent', async () => {
    const mine = await seed('Doc', { ownerId: 'author-1' })

    const vocabulary = await forItem(database.context(author), 'Doc', mine)

    expect(fieldOf(vocabulary, 'payload').update).toBe('row-dependent')
  })

  test('a rule that throws on the row denies and is logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const mine = await seed('Doc', { ownerId: 'author-1' })

    const vocabulary = await forItem(database.context(author), 'Doc', mine)

    expect(fieldOf(vocabulary, 'throwing').update).toBe('deny')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Doc.throwing'), ruleFailure)
  })

  test('an answer that is not row-dependent is not asked again', async () => {
    const mine = await seed('Doc', { ownerId: 'author-1' })
    const context = database.context(author)
    await engineContextOf(context)._sessionVocabulary?.('Doc')
    const reads = countedReads
    const updates = countedUpdates

    const vocabulary = await forItem(context, 'Doc', mine)

    expect(fieldOf(vocabulary, 'counted')).toMatchObject({ read: 'allow', update: 'allow' })
    expect(fieldOf(vocabulary, 'hookOnly').update).toBe('deny')
    expect(vocabulary.operations).toMatchObject({ update: 'allow', delete: 'allow' })
    expect(countedReads).toBe(reads)
    expect(countedUpdates).toBe(updates)
  })

  test('a filter-returning operation rule allows a row its filter matches', async () => {
    const mine = await seed('Guarded', { ownerId: 'author-1', locked: 'no' })
    const context = database.context(author)
    expect(
      (await engineContextOf(context)._sessionVocabulary?.('Guarded'))?.operations.update,
    ).toBe('row-dependent')

    const vocabulary = await forItem(context, 'Guarded', mine)

    expect(vocabulary.operations).toMatchObject({ update: 'allow', delete: 'allow' })
    expect(fieldOf(vocabulary, 'title').update).toBe('allow')
  })

  test('a filter-returning operation rule denies a row its filter does not match', async () => {
    const theirs = await seed('Guarded', { ownerId: 'someone-else', locked: 'no' })
    const locked = await seed('Guarded', { ownerId: 'author-1', locked: 'yes' })
    const context = database.context(author)

    const onTheirs = await forItem(context, 'Guarded', theirs)
    const onLocked = await forItem(context, 'Guarded', locked)

    expect(onTheirs.operations).toMatchObject({ update: 'deny', delete: 'deny' })
    expect(fieldOf(onTheirs, 'title').update).toBe('deny')
    expect(onLocked.operations).toMatchObject({ update: 'deny', delete: 'deny' })
  })

  test('sudo passes every answer through', async () => {
    const theirs = await seed('Doc', { ownerId: 'someone-else' })

    const vocabulary = await forItem(database.context(author).sudo(), 'Doc', theirs)

    expect(fieldOf(vocabulary, 'ownerDirect').update).toBe('allow')
    expect(fieldOf(vocabulary, 'hookOnly').update).toBe('deny')
  })

  test('a row that is not there denies every row-dependent answer', async () => {
    const mine = await seed('Guarded', { ownerId: 'author-1', locked: 'no' })
    const context = database.context(author)
    await database
      .context(null)
      .sudo()
      .db.Guarded.delete({ where: { id: idOf(mine) } })

    const vocabulary = await forItem(context, 'Guarded', mine)

    expect(vocabulary.operations).toMatchObject({ update: 'deny', delete: 'deny' })
    expect(fieldOf(vocabulary, 'title').update).toBe('deny')
  })

  test('an undeclared list resolves to null', async () => {
    const context = database.context(author)

    expect(await engineContextOf(context)._sessionVocabularyForItem?.('Nope', 'missing')).toBeNull()
  })
})
