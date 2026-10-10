import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { relationship, text } from '../fields/index.js'
import { ValidationError } from '../hooks/index.js'
import { createTestContext, type TestContext } from '../testing/context.js'

const BOOT = 120_000

const allow = { query: () => true, create: () => true, update: () => true, delete: () => true }

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Author: {
      fields: { name: text(), posts: relationship({ ref: 'Post.author', many: true }) },
      access: { operation: allow },
    },
    Post: {
      fields: { title: text(), author: relationship({ ref: 'Author.posts' }) },
      access: { operation: allow },
    },
  },
}

describe('write arguments', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(config, { userId: 'u1' })
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  test.each([
    ['select', { select: { id: true } }],
    ['include', { include: { author: true } }],
    ['bogus', { bogus: 1 }],
  ])('create refuses %s and writes nothing', async (key, extra) => {
    const call = harness.context.db.Post.create as unknown as (a: object) => Promise<unknown>
    await expect(call({ data: { title: `refused-${key}` }, ...extra })).rejects.toThrow(
      new RegExp(`${key}.*create\\(\\)|create\\(\\).*${key}`),
    )
    const rows = await harness.context.db.Post.where({
      title: { equals: `refused-${key}` },
    }).all()
    expect(rows).toEqual([])
  })

  test.each(['select', 'include'])('update and delete refuse %s', async (key) => {
    const row = await harness.context.db.Post.create({ data: { title: `keep-${key}` } })
    const id = String(row?.id)
    const update = harness.context.db.Post.update as unknown as (a: object) => Promise<unknown>
    const del = harness.context.db.Post.delete as unknown as (a: object) => Promise<unknown>
    await expect(update({ where: { id }, data: { title: 'changed' }, [key]: {} })).rejects.toThrow(
      ValidationError,
    )
    await expect(del({ where: { id }, [key]: {} })).rejects.toThrow(ValidationError)
    const after = await harness.context.db.Post.where({ id: { equals: id } }).first()
    expect(after).toMatchObject({ title: `keep-${key}` })
  })

  test('an undefined-valued option is not an option, and a missing argument object is refused', async () => {
    const call = harness.context.db.Post.create as unknown as (a?: object) => Promise<unknown>
    await expect(call({ data: { title: 'undef' }, select: undefined })).resolves.toMatchObject({
      title: 'undef',
    })
    await expect(call(undefined)).rejects.toThrow(ValidationError)
  })

  test('read-after-write returns the included relation', async () => {
    const result = await harness.context.transaction(async (tx) => {
      const author = await tx.db.Author.create({ data: { name: 'ann' } })
      const post = await tx.db.Post.create({
        data: { title: 'p', author: { connect: { id: String(author?.id) } } },
      })
      return tx.db.Post.where({ id: { equals: String(post?.id) } })
        .include('author')
        .first()
    })
    expect(result).toMatchObject({ author: { name: 'ann' } })
  })
})
