import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, type TestContext } from '@opensaas/stack-core/testing'
import config from '../opensaas.config.js'

const BOOT = 120_000

/** Narrows away the silent-denial `null` every secured read and write can return. */
function present<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`${what} returned null — denied, or not found`)
  return value
}

describe('json fields round-trip through the secured context', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(await config, null)
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  it('stores and reads back a nested object', async () => {
    const metadata = {
      dimensions: { width: 12, height: 4.5, unit: 'cm' },
      tags: ['new', 'featured'],
      supplier: { name: 'Acme', contacts: [{ kind: 'email', value: 'sales@example.com' }] },
      discontinued: false,
    }

    const created = present(
      await harness.context.db.Product.create({
        data: { name: 'Widget', metadata, configuration: { sku: 'W-1', variants: [] } },
      }),
      'Product.create',
    )

    const read = present(
      await harness.context.db.Product.where({ id: { equals: created.id } }).first(),
      'Product read',
    )
    expect(read.metadata).toEqual(metadata)
    expect(read.configuration).toEqual({ sku: 'W-1', variants: [] })
  })

  it('replaces a nested value on update', async () => {
    const created = present(
      await harness.context.db.Product.create({
        data: {
          name: 'Gadget',
          configuration: { sku: 'G-1' },
          settings: { theme: { mode: 'dark' } },
        },
      }),
      'Product.create',
    )

    const updated = present(
      await harness.context.db.Product.update({
        where: { id: created.id },
        data: { settings: { theme: { mode: 'light', accent: '#16a34a' }, notifications: null } },
      }),
      'Product.update',
    )
    expect(updated.settings).toEqual({
      theme: { mode: 'light', accent: '#16a34a' },
      notifications: null,
    })
  })

  it('leaves an optional json field null when it is not written', async () => {
    const created = present(
      await harness.context.db.Article.create({ data: { title: 'Untagged' } }),
      'Article.create',
    )

    const read = present(
      await harness.context.db.Article.where({ id: { equals: created.id } }).first(),
      'Article read',
    )
    expect(read.content).toBeNull()
    expect(read.taxonomy).toBeNull()
  })

  it('round-trips a top-level array', async () => {
    const taxonomy = [
      { category: 'guides', tags: ['json', 'fields'] },
      { category: 'reference', tags: [] },
    ]

    const created = present(
      await harness.context.db.Article.create({ data: { title: 'Working with JSON', taxonomy } }),
      'Article.create',
    )

    const read = present(
      await harness.context.db.Article.where({ id: { equals: created.id } }).first(),
      'Article read',
    )
    expect(read.taxonomy).toEqual(taxonomy)
  })
})
