import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import type { Session } from './types.js'
import { engineContextOf } from '../context/engine-context.js'
import { relationship, text } from '../fields/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'

const BOOT = 120_000

const editor: Session = { userId: 'editor-1' }

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Post: {
      fields: {
        secret: text({ access: { read: () => false } }),
        shout: text({ hooks: { resolveOutput: ({ value }) => String(value).toUpperCase() } }),
        noComments: text({
          access: { update: ({ item }) => item?.comments?.length === 0 },
        }),
        secretOpen: text({ access: { update: ({ item }) => item?.secret === 'open' } }),
        quiet: text({ access: { update: ({ item }) => item?.shout === 'quiet' } }),
        readNoComments: text({
          access: { read: ({ item }) => item?.comments?.length === 0 },
        }),
        readSecretOpen: text({ access: { read: ({ item }) => item?.secret === 'open' } }),
        readQuiet: text({ access: { read: ({ item }) => item?.shout === 'quiet' } }),
        comments: relationship({ ref: 'Comment.post', many: true }),
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
    Comment: {
      fields: { body: text(), post: relationship({ ref: 'Post.comments' }) },
      access: {
        operation: {
          query: () => true,
          create: () => true,
          update: () => true,
          delete: () => true,
        },
      },
    },
  },
}

const updateRules = ['noComments', 'secretOpen', 'quiet'] as const
const readRules = ['readNoComments', 'readSecretOpen', 'readQuiet'] as const

describe('the Session vocabulary for one row answers as the engine does', () => {
  let database: TestDatabase

  beforeAll(async () => {
    database = await createTestDatabase(config)
  }, BOOT)

  afterAll(async () => {
    await database?.close()
  })

  beforeEach(async () => {
    await database.truncate()
  })

  async function seed(secret: string, shout: string): Promise<string> {
    const post = await database
      .context(null)
      .sudo()
      .db.Post.create({
        data: {
          secret,
          shout,
          noComments: 'n',
          secretOpen: 's',
          quiet: 'q',
          readNoComments: 'r',
          readSecretOpen: 'r',
          readQuiet: 'r',
        },
      })
    return String(post?.id)
  }

  async function vocabularyFor(id: string) {
    const vocabulary = await engineContextOf(database.context(editor))._sessionVocabularyForItem?.(
      'Post',
      id,
    )
    if (vocabulary === undefined || vocabulary === null) throw new Error('No vocabulary')
    return vocabulary
  }

  async function updateSucceeds(id: string, fieldName: string): Promise<boolean> {
    try {
      const updated = await database
        .context(editor)
        .db.Post.update({ where: { id }, data: { [fieldName]: 'changed' } })
      return updated !== null
    } catch {
      return false
    }
  }

  test.each([
    ['open', 'quiet'],
    ['closed', 'loud'],
  ])('an update rule answers for the stored row (secret %s, shout %s)', async (secret, shout) => {
    const id = await seed(secret, shout)
    const vocabulary = await vocabularyFor(id)

    for (const fieldName of updateRules) {
      const answer = vocabulary.fields.get(fieldName)?.update
      expect([fieldName, answer]).toEqual([
        fieldName,
        (await updateSucceeds(id, fieldName)) ? 'allow' : 'deny',
      ])
    }
  })

  test.each([
    ['open', 'quiet'],
    ['closed', 'loud'],
  ])('a read rule answers for the stored row (secret %s, shout %s)', async (secret, shout) => {
    const id = await seed(secret, shout)
    const vocabulary = await vocabularyFor(id)
    const row = await database
      .context(editor)
      .db.Post.where({ id: { equals: id } })
      .first()
    if (row === null) throw new Error('No row')

    for (const fieldName of readRules) {
      const answer = vocabulary.fields.get(fieldName)?.read
      expect([fieldName, answer]).toEqual([
        fieldName,
        Object.hasOwn(row, fieldName) ? 'allow' : 'deny',
      ])
    }
  })

  test('a rule reading a relation the stored row does not carry denies, as the write does', async () => {
    const id = await seed('open', 'quiet')

    const vocabulary = await vocabularyFor(id)

    expect(vocabulary.fields.get('noComments')?.update).toBe('deny')
    await expect(
      database.context(editor).db.Post.update({ where: { id }, data: { noComments: 'x' } }),
    ).rejects.toThrow(/noComments/)
  })
})
