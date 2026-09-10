import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, type TestContext } from '@opensaas/stack-core/testing'
import config from '../opensaas.config.js'

const BOOT = 120_000

/** Narrows away the silent-denial `null` every secured read and write can return. */
function present<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`${what} returned null — denied, or not found`)
  return value
}

/** The shape Tiptap actually serializes: a nested document with marks. */
const DOC = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Introduction' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Rich text is ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'stored as JSON' },
        { type: 'text', text: ' and read back unchanged.' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nested' }] }],
        },
      ],
    },
  ],
}

describe('rich text round-trips through the secured context', () => {
  let harness: TestContext
  let authorId: string

  beforeAll(async () => {
    harness = await createTestContext(await config, null)
    const author = present(
      await harness.context.sudo().db.User.create({
        data: { name: 'Ada', email: 'ada@example.com' },
      }),
      'User.create',
    )
    authorId = author.id
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  it('stores and reads back a nested Tiptap document', async () => {
    const context = harness.context.withSession({ userId: authorId })
    const created = present(
      await context.db.Article.create({
        data: { title: 'Rich text', content: DOC, author: { connect: { id: authorId } } },
      }),
      'Article.create',
    )

    const read = present(
      await context.db.Article.where({ id: { equals: created.id } }).first(),
      'Article read',
    )
    expect(read.content).toEqual(DOC)
  })

  it('persists an edit to the document', async () => {
    const context = harness.context.withSession({ userId: authorId })
    const created = present(
      await context.db.Article.create({
        data: { title: 'Draft', content: DOC, author: { connect: { id: authorId } } },
      }),
      'Article.create',
    )

    const edited = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rewritten.' }] }],
    }
    const updated = present(
      await context.db.Article.update({ where: { id: created.id }, data: { content: edited } }),
      'Article.update',
    )
    expect(updated.content).toEqual(edited)

    const read = present(
      await context.db.Article.where({ id: { equals: created.id } }).first(),
      'Article read',
    )
    expect(read.content).toEqual(edited)
  })

  it('leaves an optional rich text field null, and fills it on demand', async () => {
    const context = harness.context.withSession({ userId: authorId })
    const created = present(
      await context.db.Article.create({
        data: { title: 'No excerpt', content: DOC, author: { connect: { id: authorId } } },
      }),
      'Article.create',
    )
    expect(created.excerpt).toBeNull()

    const excerpt = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A short summary.' }] }],
    }
    const updated = present(
      await context.db.Article.update({ where: { id: created.id }, data: { excerpt } }),
      'Article.update',
    )
    expect(updated.excerpt).toEqual(excerpt)
  })

  it('derives the slug from the title on create', async () => {
    const context = harness.context.withSession({ userId: authorId })
    const created = present(
      await context.db.Article.create({
        data: {
          title: 'Hello, Rich Text World!',
          content: DOC,
          author: { connect: { id: authorId } },
        },
      }),
      'Article.create',
    )
    expect(created.slug).toBe('hello-rich-text-world')
  })

  it('reads the article back through its author relation', async () => {
    const context = harness.context.withSession({ userId: authorId })
    const created = present(
      await context.db.Article.create({
        data: { title: 'Related', content: DOC, author: { connect: { id: authorId } } },
      }),
      'Article.create',
    )

    const read = present(
      await context.db.Article.where({ id: { equals: created.id } })
        .include('author')
        .first(),
      'Article read',
    )
    // A to-one include is `Row | null` whether or not its column is nullable.
    expect(read.author?.name).toBe('Ada')
  })
})
