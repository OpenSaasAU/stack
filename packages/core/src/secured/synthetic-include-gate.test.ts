import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { text, relationship } from '../fields/index.js'
import { createTestContext, type TestContext } from '../testing/context.js'
import type { OpenSaasConfig } from '../config/types.js'

const BOOT = 120_000

function gatedConfig(read: (args: { item?: Record<string, unknown> }) => boolean): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      Category: {
        fields: { name: text() },
        access: { operation: { query: () => true, create: () => true } },
      },
      Post: {
        fields: {
          title: text(),
          category: relationship({ ref: 'Category', access: { read } }),
        },
        access: { operation: { query: () => true, create: () => true } },
      },
    },
  }
}

describe('synthetic back-relation include honours the source field read gate (#1812)', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(
      gatedConfig(() => false),
      null,
    )
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  test(
    'an include of from_Post_category does not leak the link a read-denied field hides',
    async () => {
      const { db } = harness.context
      const category = await db.Category.create({ data: { name: 'c1' } })
      if (category === null) throw new Error('setup')
      await db.Post.create({ data: { title: 'p1', category: { connect: { id: category.id } } } })

      const rows = await db.Category.include('from_Post_category').all()
      expect(rows).toHaveLength(1)
      expect(rows[0].name).toBe('c1')
      expect(rows[0].from_Post_category ?? []).toEqual([])
    },
    BOOT,
  )
})

describe('synthetic back-relation include with a row-dependent source rule (#1812)', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(
      gatedConfig(({ item }) => item?.title !== 'hidden'),
      null,
    )
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  test(
    'keeps only the readable related rows when an earlier row is denied',
    async () => {
      const { db } = harness.context
      const category = await db.Category.create({ data: { name: 'c1' } })
      if (category === null) throw new Error('setup')
      await db.Post.create({
        data: { title: 'hidden', category: { connect: { id: category.id } } },
      })
      await db.Post.create({
        data: { title: 'shown', category: { connect: { id: category.id } } },
      })

      const rows = await db.Category.include('from_Post_category').all()
      const posts = rows[0].from_Post_category
      if (!Array.isArray(posts)) throw new Error('expected a to-many')
      expect(posts.map((post) => post.title)).toEqual(['shown'])
    },
    BOOT,
  )

  test(
    'refuses a bare count and a combine count over the row-dependent synthetic relation',
    async () => {
      const { db } = harness.context
      const category = await db.Category.create({ data: { name: 'c2' } })
      if (category === null) throw new Error('setup')
      await db.Post.create({
        data: { title: 'hidden', category: { connect: { id: category.id } } },
      })

      await expect(
        db.Category.include('from_Post_category', (posts) => posts.count()).all(),
      ).rejects.toThrow(/Cannot count/)
      await expect(
        db.Category.include('from_Post_category', (posts) =>
          posts.combine({ all: posts.count() }),
        ).all(),
      ).rejects.toThrow(/Cannot count/)
    },
    BOOT,
  )

  test(
    'a sudo read still counts the link',
    async () => {
      const { db } = harness.context
      const category = await db.Category.create({ data: { name: 'c3' } })
      if (category === null) throw new Error('setup')
      await db.Post.create({
        data: { title: 'hidden', category: { connect: { id: category.id } } },
      })

      const rows = await harness.context
        .sudo()
        .db.Category.where({ name: { equals: 'c3' } })
        .include('from_Post_category', (posts) => posts.count())
        .all()
      expect(rows[0].from_Post_category).toBe(1)
    },
    BOOT,
  )
})

describe('synthetic back-relation count with a row-independent allow rule (#1910)', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(
      gatedConfig(() => true),
      null,
    )
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  test(
    'still counts',
    async () => {
      const { db } = harness.context
      const category = await db.Category.create({ data: { name: 'c4' } })
      if (category === null) throw new Error('setup')
      await db.Post.create({ data: { title: 'p', category: { connect: { id: category.id } } } })

      const rows = await db.Category.include('from_Post_category', (posts) => posts.count()).all()
      expect(rows[0].from_Post_category).toBe(1)
    },
    BOOT,
  )
})

describe('synthetic back-relation include answers the same rule with and without select() (#2066)', () => {
  function projectionConfig(
    read: (args: {
      item?: Record<string, unknown>
      session?: { userId?: string } | null
    }) => boolean,
  ): OpenSaasConfig {
    const allow = { operation: { query: () => true, create: () => true } }
    return {
      db: { provider: 'postgresql' },
      lists: {
        Region: {
          fields: {
            name: text(),
            categories: relationship({ ref: 'Category.region', many: true }),
          },
          access: allow,
        },
        Category: {
          fields: { name: text(), region: relationship({ ref: 'Region.categories' }) },
          access: allow,
        },
        Post: {
          fields: {
            title: text(),
            visibility: text(),
            owner: text(),
            category: relationship({ ref: 'Category', access: { read } }),
          },
          access: allow,
        },
      },
    }
  }

  async function seed(harness: TestContext) {
    const { db } = harness.context
    const region = await db.Region.create({ data: { name: 'r' } })
    if (region === null) throw new Error('setup')
    const category = await db.Category.create({
      data: { name: 'c', region: { connect: { id: region.id } } },
    })
    if (category === null) throw new Error('setup')
    const link = { category: { connect: { id: category.id } } }
    await db.Post.create({
      data: { title: 'public post', visibility: 'public', owner: 'me', ...link },
    })
    await db.Post.create({
      data: { title: 'PRIVATE post', visibility: 'private', owner: 'other', ...link },
    })
  }

  const titles = (rows: readonly { title: string }[] | unknown): string[] => {
    if (!Array.isArray(rows)) throw new Error('expected a to-many')
    return rows.map((row: { title: string }) => row.title)
  }

  describe('fail-open rule', () => {
    let harness: TestContext
    beforeAll(async () => {
      harness = await createTestContext(
        projectionConfig(({ item }) => item?.visibility !== 'private'),
        null,
      )
      await seed(harness)
    }, BOOT)
    afterAll(async () => {
      await harness?.close()
    })

    test(
      'select() does not leak the hidden row',
      async () => {
        const { db } = harness.context
        const plain = await db.Category.include('from_Post_category').all()
        const projected = await db.Category.include('from_Post_category', (p) =>
          p.select('title'),
        ).all()
        expect(titles(plain[0].from_Post_category)).toEqual(['public post'])
        expect(titles(projected[0].from_Post_category)).toEqual(['public post'])
      },
      BOOT,
    )

    test(
      'holds when nested under another include',
      async () => {
        const { db } = harness.context
        const rows = await db.Region.include('categories', (c) =>
          c.include('from_Post_category', (p) => p.select('title')),
        ).all()
        const categories = rows[0].categories
        if (!Array.isArray(categories)) throw new Error('expected a to-many')
        expect(titles(categories[0].from_Post_category)).toEqual(['public post'])
      },
      BOOT,
    )
  })

  describe('fail-closed rule', () => {
    let harness: TestContext
    beforeAll(async () => {
      harness = await createTestContext(
        projectionConfig(({ item }) => item?.owner === 'me'),
        null,
      )
      await seed(harness)
    }, BOOT)
    afterAll(async () => {
      await harness?.close()
    })

    test(
      'select() does not hide the readable row',
      async () => {
        const { db } = harness.context
        const plain = await db.Category.include('from_Post_category').all()
        const projected = await db.Category.include('from_Post_category', (p) =>
          p.select('title'),
        ).all()
        expect(titles(plain[0].from_Post_category)).toEqual(['public post'])
        expect(titles(projected[0].from_Post_category)).toEqual(['public post'])
      },
      BOOT,
    )

    test(
      'holds when nested under another include',
      async () => {
        const { db } = harness.context
        const rows = await db.Region.include('categories', (c) =>
          c.include('from_Post_category', (p) => p.select('title')),
        ).all()
        const categories = rows[0].categories
        if (!Array.isArray(categories)) throw new Error('expected a to-many')
        expect(titles(categories[0].from_Post_category)).toEqual(['public post'])
      },
      BOOT,
    )
  })
})
