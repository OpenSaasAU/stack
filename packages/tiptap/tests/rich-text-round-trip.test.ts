// What `richText()` promises against a real schema (issue #1310): a jsonb
// column, read and written unchanged, with its own required/optional
// nullability and field-level access — proven over `context.db` on the Test
// context rather than only against the builder's own functions.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { createTestContext, type TestContext } from '@opensaas/stack-core/testing'
import { richText } from '../src/fields/richText.js'

const BOOT = 120_000

/** Narrows away the silent-denial `null` every secured read and write can return. */
function present<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`${what} returned null — denied, or not found`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The untyped Test context hands back an unknown `id`; every `where` needs a string. */
function idOf(row: unknown): string {
  const id = isRecord(row) ? row.id : undefined
  if (typeof id !== 'string') throw new Error('expected a string id')
  return id
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
  ],
}

const EDITED = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rewritten.' }] }],
}

const OPEN = { query: () => true, create: () => true, update: () => true }

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Article: {
      fields: {
        title: text(),
        content: richText({ validation: { isRequired: true } }),
        excerpt: richText(),
      },
      access: { operation: OPEN },
    },
    Locked: {
      fields: {
        title: text(),
        content: richText({ access: { update: () => false } }),
      },
      access: { operation: OPEN },
    },
  },
}

describe('richText() against a real column (Test context)', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(config, null)
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    await harness.truncate()
  })

  /** The raw row, reached through the (already-marked) Unsafe surface. */
  async function rawRow(model: string, id: string): Promise<Record<string, unknown>> {
    const orm: unknown = harness.context.unsafe.orm
    const namespace: unknown = isRecord(orm) ? orm.public : undefined
    const collection: unknown = isRecord(namespace) ? namespace[model] : undefined
    if (!isRecord(collection) || typeof collection.where !== 'function') {
      throw new Error(`no collection "${model}" on the Unsafe surface`)
    }
    const builder: unknown = collection.where.call(collection, { id })
    if (!isRecord(builder) || typeof builder.first !== 'function') {
      throw new Error(`collection "${model}" where() carries no first()`)
    }
    const row: unknown = await builder.first.call(builder)
    if (!isRecord(row)) throw new Error(`no raw row for "${model}" id ${id}`)
    return row
  }

  it('stores and reads back a nested Tiptap document', async () => {
    const created = present(
      await harness.context.db.Article.create({ data: { title: 'Rich text', content: DOC } }),
      'Article.create',
    )
    expect(created.content).toEqual(DOC)

    const read = present(
      await harness.context.db.Article.where({ id: { equals: idOf(created) } }).first(),
      'Article read',
    )
    expect(read.content).toEqual(DOC)

    // Backed by one jsonb column under the field's own name.
    const raw = await rawRow('Article', idOf(created))
    expect(raw.content).toEqual(DOC)
  })

  it('persists an edit to the document', async () => {
    const created = present(
      await harness.context.db.Article.create({ data: { title: 'Draft', content: DOC } }),
      'Article.create',
    )

    const updated = present(
      await harness.context.db.Article.update({
        where: { id: idOf(created) },
        data: { content: EDITED },
      }),
      'Article.update',
    )
    expect(updated.content).toEqual(EDITED)

    const read = present(
      await harness.context.db.Article.where({ id: { equals: idOf(created) } }).first(),
      'Article read',
    )
    expect(read.content).toEqual(EDITED)
  })

  it('leaves an optional rich text field null, and fills it on demand', async () => {
    const created = present(
      await harness.context.db.Article.create({ data: { title: 'No excerpt', content: DOC } }),
      'Article.create',
    )
    expect(created.excerpt).toBeNull()

    const excerpt = { type: 'doc', content: [{ type: 'paragraph', content: [] }] }
    const updated = present(
      await harness.context.db.Article.update({
        where: { id: idOf(created) },
        data: { excerpt },
      }),
      'Article.update',
    )
    expect(updated.excerpt).toEqual(excerpt)
  })

  it('a required field rejects a create with no content', async () => {
    await expect(
      harness.context.db.Article.create({ data: { title: 'Missing content' } }),
    ).rejects.toThrow()

    expect(await harness.context.db.Article.where({}).first()).toBeNull()
  })

  describe('field-level access on the logical key', () => {
    it('THROWS on a denied update, and the stored value is untouched', async () => {
      const created = present(
        await harness.context.db.Locked.create({ data: { title: 'Locked', content: DOC } }),
        'Locked.create',
      )

      await expect(
        harness.context.db.Locked.update({
          where: { id: idOf(created) },
          data: { content: EDITED },
        }),
      ).rejects.toThrow('Cannot update "content": field-level access denied.')

      const read = present(
        await harness.context.db.Locked.where({ id: { equals: idOf(created) } }).first(),
        'Locked read',
      )
      expect(read.content).toEqual(DOC)
    })

    it('a sudo write bypasses the denial', async () => {
      const created = present(
        await harness.context.db.Locked.create({ data: { title: 'Locked', content: DOC } }),
        'Locked.create',
      )

      const updated = present(
        await harness.context
          .sudo()
          .db.Locked.update({ where: { id: idOf(created) }, data: { content: EDITED } }),
        'sudo update',
      )
      expect(updated.content).toEqual(EDITED)
    })
  })
})
