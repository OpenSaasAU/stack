import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { relationship, text } from '../fields/index.js'
import { createTestContext, type TestContext } from '../testing/context.js'

const BOOT = 120_000
const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Author: {
      fields: { name: text(), posts: relationship({ ref: 'Post.author', many: true }) },
      access: { operation: OPEN },
    },
    Post: {
      fields: {
        title: text(),
        author: relationship({ ref: 'Author.posts' }),
        tags: relationship({ ref: 'PostTag.post', many: true }),
      },
      access: { operation: OPEN },
    },
    Tag: {
      fields: { name: text() },
      access: { operation: OPEN },
    },
    PostTag: {
      fields: {
        post: relationship({ ref: 'Post.tags' }),
        tag: relationship({ ref: 'Tag' }),
      },
      access: { operation: OPEN },
    },
  },
}

let harness: TestContext
const ids: Record<string, string> = {}

async function create(listKey: string, data: Record<string, unknown>): Promise<string> {
  const result = await harness.context.serverAction({ listKey, action: 'create', data })
  return String((result as { data: { id: unknown } }).data.id)
}

beforeAll(async () => {
  harness = await createTestContext(config, { userId: 'admin' })
  ids.priya = await create('Author', { name: 'Priya' })
  ids.omar = await create('Author', { name: 'Omar' })
  ids.mine = await create('Post', { title: 'Mine', author: { connect: { id: ids.priya } } })
  ids.theirs = await create('Post', { title: 'Theirs', author: { connect: { id: ids.omar } } })
  ids.loose = await create('Post', { title: 'Loose' })
  ids.red = await create('Tag', { name: 'Red' })
  ids.blue = await create('Tag', { name: 'Blue' })
  await create('PostTag', {
    post: { connect: { id: ids.mine } },
    tag: { connect: { id: ids.red } },
  })
}, BOOT)

afterAll(async () => {
  await harness?.close()
})

async function labels(input: {
  listKey: string
  field: string
  linkableFor?: string
  search?: string
}): Promise<string[]> {
  const response = await harness.context.serverAction({ action: 'relationshipOptions', ...input })
  const { options } = response as { options: Array<{ label: string }> }
  return options.map((option) => option.label).sort()
}

describe('relationshipOptions for linking an existing record', () => {
  test(
    'leaves out the records already linked through a foreign key',
    async () => {
      expect(await labels({ listKey: 'Author', field: 'posts', linkableFor: ids.priya })).toEqual([
        'Loose',
        'Theirs',
      ])
    },
    BOOT,
  )

  test(
    'leaves out the far records already linked through a junction',
    async () => {
      expect(await labels({ listKey: 'Post', field: 'tags', linkableFor: ids.mine })).toEqual([
        'Blue',
      ])
      expect(await labels({ listKey: 'Post', field: 'tags', linkableFor: ids.theirs })).toEqual([
        'Blue',
        'Red',
      ])
    },
    BOOT,
  )

  test(
    'still applies the search',
    async () => {
      expect(
        await labels({ listKey: 'Author', field: 'posts', linkableFor: ids.priya, search: 'the' }),
      ).toEqual(['Theirs'])
    },
    BOOT,
  )

  test(
    'offers every record when no parent is named',
    async () => {
      expect(await labels({ listKey: 'Author', field: 'posts' })).toEqual([
        'Loose',
        'Mine',
        'Theirs',
      ])
    },
    BOOT,
  )

  test(
    'offers nothing for a parent id the list cannot hold',
    async () => {
      expect(await labels({ listKey: 'Author', field: 'posts', linkableFor: 'not-an-id' })).toEqual(
        [],
      )
    },
    BOOT,
  )
})
