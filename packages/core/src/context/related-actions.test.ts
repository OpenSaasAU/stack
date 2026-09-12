import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import pg from 'pg'
import type { AccessControlledDB, Session } from '../access/index.js'
import type { OpenSaasConfig } from '../config/types.js'
import { relationship, text } from '../fields/index.js'
import { createTestContext, ormClientFor, type TestContext } from '../testing/context.js'
import type { StackContext } from '../types/context.js'
import { getContext } from './index.js'

/**
 * The relationship table's server actions over a real database (#758, #1153).
 *
 * Two guarantees were parked while `connect` was refused outright and no
 * relation input reached the database at all: which row a pre-linked create
 * links to, and the to-one/to-many split the remove control turns on. Both are
 * live again with the lowering, so both are asserted here on stored rows.
 */

const BOOT = 120_000

const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }

function schemaConfig(postDelete: () => boolean = () => true): OpenSaasConfig {
  return {
    db: { provider: 'postgresql', timestamps: true },
    lists: {
      Author: {
        fields: {
          name: text(),
          posts: relationship({ ref: 'Post.author', many: true }),
          // The non-owning half of a one-to-one: `Bio.author` claims the
          // foreign key below, so this side owns no column (#1442).
          bio: relationship({ ref: 'Bio.author' }),
        },
        access: { operation: OPEN },
      },
      Post: {
        fields: {
          title: text(),
          author: relationship({ ref: 'Author.posts' }),
          // A list-only ref: synthesises the always-non-owning
          // `from_Post_category` back-relation on Category (#1442).
          category: relationship({ ref: 'Category' }),
        },
        access: { operation: { ...OPEN, delete: postDelete } },
      },
      Bio: {
        fields: {
          notes: text(),
          author: relationship({ ref: 'Author.bio', db: { foreignKey: true } }),
        },
        access: { operation: OPEN },
      },
      Category: {
        fields: { name: text() },
        access: { operation: OPEN },
      },
    },
  }
}

async function storedLinks(url: string): Promise<Array<{ title: string; author: string | null }>> {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    const result = await client.query(
      'select "title", "authorId" as "author" from "public"."Post" order by "title"',
    )
    return result.rows.map((row: { title: string; author: string | null }) => ({
      title: row.title,
      author: row.author,
    }))
  } finally {
    await client.end()
  }
}

async function storedBioLinks(
  url: string,
): Promise<Array<{ notes: string; author: string | null }>> {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    const result = await client.query(
      'select "notes", "authorId" as "author" from "public"."Bio" order by "notes"',
    )
    return result.rows.map((row: { notes: string; author: string | null }) => ({
      notes: row.notes,
      author: row.author,
    }))
  } finally {
    await client.end()
  }
}

async function storedPostCategories(
  url: string,
): Promise<Array<{ title: string; category: string | null }>> {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    const result = await client.query(
      'select "title", "categoryId" as "category" from "public"."Post" order by "title"',
    )
    return result.rows.map((row: { title: string; category: string | null }) => ({
      title: row.title,
      category: row.category,
    }))
  } finally {
    await client.end()
  }
}

async function storedAuthorNames(url: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    const result = await client.query('select "name" from "public"."Author" order by "name"')
    return result.rows.map((row: { name: string }) => row.name)
  } finally {
    await client.end()
  }
}

describe('the relationship table server actions over a real database', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(schemaConfig(), { userId: 'u1' })
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    await harness.truncate()
  })

  function contextAt(
    config: OpenSaasConfig,
    session: Session | null,
  ): StackContext<AccessControlledDB> {
    const orm = ormClientFor(harness.data, harness.client.orm)
    return getContext(config, orm, session, undefined, false, undefined, undefined, harness.client)
  }

  async function seedAuthor(name: string): Promise<string> {
    const author = await harness.context.db.Author.create({ data: { name } })
    return String(author?.id)
  }

  async function seedBio(notes: string): Promise<string> {
    const bio = await harness.context.db.Bio.create({ data: { notes } })
    return String(bio?.id)
  }

  async function seedCategory(name: string): Promise<string> {
    const category = await harness.context.db.Category.create({ data: { name } })
    return String(category?.id)
  }

  /**
   * The link target's identity (#758). Both ids below name real, readable
   * rows, so the write succeeds either way — what separates a server that
   * chose the parent from one that took the client's word is which row the
   * stored foreign key points at.
   */
  test(
    'createRelated links the parent the server chose, not the one the client named',
    async () => {
      const owner = await seedAuthor('owner')
      const attacker = await seedAuthor('attacker')

      const result = await harness.context.serverAction({
        listKey: 'Post',
        action: 'createRelated',
        data: { title: 'New', author: { connect: { id: attacker } } },
        field: 'author',
        parentId: owner,
      })

      expect(result).toMatchObject({ created: true })
      expect(await storedLinks(harness.url)).toEqual([{ title: 'New', author: owner }])
    },
    BOOT,
  )

  test(
    'createRelated overwrites a hostile bare column value with the trusted parent',
    async () => {
      const owner = await seedAuthor('owner')
      const attacker = await seedAuthor('attacker')

      const result = await harness.context.serverAction({
        listKey: 'Post',
        action: 'createRelated',
        data: { title: 'New', author: attacker },
        field: 'author',
        parentId: owner,
      })

      expect(result).toMatchObject({ created: true })
      expect(await storedLinks(harness.url)).toEqual([{ title: 'New', author: owner }])
    },
    BOOT,
  )

  /**
   * The other arity branch: a to-many back-reference owns no column on the row
   * being created, so there is nowhere for the parent to go (ADR-0050). A
   * server that emitted the to-one shape for both branches reaches the engine's
   * own refusal instead of this one, which is what the message pins.
   */
  test(
    'createRelated refuses a to-many back-reference by naming its ownership',
    async () => {
      await seedAuthor('owner')
      const post = await harness.context.db.Post.create({ data: { title: 'p' } })

      const result = await harness.context.serverAction({
        listKey: 'Author',
        action: 'createRelated',
        data: { name: 'new' },
        field: 'posts',
        parentId: String(post?.id),
      })

      expect(result).toMatchObject({ created: false })
      expect((result as { error?: string }).error).toContain('non-owning back-reference')
      expect(await storedAuthorNames(harness.url)).toEqual(['owner'])
    },
    BOOT,
  )

  /**
   * The non-owning half of a one-to-one (#1442): `Author.bio` has `many`
   * falsy exactly like the owning `Post.author`, so a guard keyed on arity
   * alone lets this one through — it must be caught on ownership instead.
   */
  test(
    'createRelated refuses the non-owning half of a one-to-one',
    async () => {
      const bioId = await seedBio('existing')

      const result = await harness.context.serverAction({
        listKey: 'Author',
        action: 'createRelated',
        data: { name: 'new' },
        field: 'bio',
        parentId: bioId,
      })

      expect(result).toMatchObject({ created: false })
      expect((result as { error?: string }).error).toContain('non-owning back-reference')
      expect(await storedAuthorNames(harness.url)).toEqual([])
    },
    BOOT,
  )

  /**
   * A synthetic `from_<List>_<field>` back-relation (#1442): never declared,
   * so never itself in `listConfig.fields` — the undeclared shape the guard's
   * `!!backRefField` check used to mistake for "not many" and let through.
   */
  test(
    'createRelated refuses a synthetic back-relation',
    async () => {
      const post = await harness.context.db.Post.create({ data: { title: 'p' } })

      const result = await harness.context.serverAction({
        listKey: 'Category',
        action: 'createRelated',
        data: { name: 'new' },
        field: 'from_Post_category',
        parentId: String(post?.id),
      })

      expect(result).toMatchObject({ created: false })
      expect((result as { error?: string }).error).toContain('non-owning back-reference')
    },
    BOOT,
  )

  /**
   * Remove on a to-many nulls the foreign key — the row itself survives
   * (ADR-0018). Collapsing this branch onto the delete one destroys an
   * endpoint the caller only asked to unlink.
   */
  test(
    'removeRelated disconnect nulls the back-reference and keeps the row',
    async () => {
      const authorId = await seedAuthor('ada')
      const post = await harness.context.db.Post.create({
        data: { title: 'ship it', author: { connect: { id: authorId } } },
      })

      const result = await harness.context.serverAction({
        listKey: 'Post',
        action: 'removeRelated',
        mode: 'disconnect',
        id: String(post?.id),
        field: 'author',
      })

      expect(result).toEqual({ removed: true })
      expect(await storedLinks(harness.url)).toEqual([{ title: 'ship it', author: null }])
      expect(await storedAuthorNames(harness.url)).toEqual(['ada'])
    },
    BOOT,
  )

  test(
    'removeRelated delete removes the junction row itself',
    async () => {
      const authorId = await seedAuthor('ada')
      const post = await harness.context.db.Post.create({
        data: { title: 'ship it', author: { connect: { id: authorId } } },
      })

      const result = await harness.context.serverAction({
        listKey: 'Post',
        action: 'removeRelated',
        mode: 'delete',
        id: String(post?.id),
      })

      expect(result).toEqual({ removed: true })
      expect(await storedLinks(harness.url)).toEqual([])
      expect(await storedAuthorNames(harness.url)).toEqual(['ada'])
    },
    BOOT,
  )

  test(
    'removeRelated delete is refused when that list denies delete',
    async () => {
      const authorId = await seedAuthor('ada')
      const post = await harness.context.db.Post.create({
        data: { title: 'ship it', author: { connect: { id: authorId } } },
      })

      const denied = contextAt(
        schemaConfig(() => false),
        { userId: 'u1' },
      )
      const result = await denied.serverAction({
        listKey: 'Post',
        action: 'removeRelated',
        mode: 'delete',
        id: String(post?.id),
      })

      expect(result).toEqual({ removed: false, error: 'Access denied or operation failed' })
      expect(await storedLinks(harness.url)).toEqual([{ title: 'ship it', author: authorId }])
    },
    BOOT,
  )

  test(
    'removeRelated refuses to disconnect through a to-many back-reference',
    async () => {
      const authorId = await seedAuthor('ada')
      await harness.context.db.Post.create({
        data: { title: 'ship it', author: { connect: { id: authorId } } },
      })

      const result = await harness.context.serverAction({
        listKey: 'Author',
        action: 'removeRelated',
        mode: 'disconnect',
        id: authorId,
        field: 'posts',
      })

      expect(result).toMatchObject({ removed: false })
      expect((result as { error?: string }).error).toContain('non-owning back-reference')
      expect(await storedLinks(harness.url)).toEqual([{ title: 'ship it', author: authorId }])
      expect(await storedAuthorNames(harness.url)).toEqual(['ada'])
    },
    BOOT,
  )

  /**
   * The non-owning half of a one-to-one (#1442): `many` is falsy on both
   * `Author.bio` and the owning `Bio.author`, so the old arity guard let this
   * one through to an `update` that the engine's own ownership check refused.
   */
  test(
    'removeRelated refuses to disconnect through the non-owning half of a one-to-one',
    async () => {
      const authorId = await seedAuthor('ada')
      const bioId = await seedBio('bio')
      await harness.context.db.Bio.update({
        where: { id: bioId },
        data: { author: { connect: { id: authorId } } },
      })

      const result = await harness.context.serverAction({
        listKey: 'Author',
        action: 'removeRelated',
        mode: 'disconnect',
        id: authorId,
        field: 'bio',
      })

      expect(result).toMatchObject({ removed: false })
      expect((result as { error?: string }).error).toContain('non-owning back-reference')
      expect(await storedBioLinks(harness.url)).toEqual([{ notes: 'bio', author: authorId }])
    },
    BOOT,
  )

  /**
   * A synthetic `from_<List>_<field>` back-relation (#1442): undeclared, so
   * `listConfig.fields[field]` is `undefined` and the old guard's
   * `!!backRefField` check read that as "not many" — this is the shape the
   * issue's reachability note asked to confirm rather than assume.
   */
  test(
    'removeRelated refuses to disconnect through a synthetic back-relation',
    async () => {
      const categoryId = await seedCategory('news')
      await harness.context.db.Post.create({
        data: { title: 'story', category: { connect: { id: categoryId } } },
      })

      const result = await harness.context.serverAction({
        listKey: 'Category',
        action: 'removeRelated',
        mode: 'disconnect',
        id: categoryId,
        field: 'from_Post_category',
      })

      expect(result).toMatchObject({ removed: false })
      expect((result as { error?: string }).error).toContain('non-owning back-reference')
      expect(await storedPostCategories(harness.url)).toEqual([
        { title: 'story', category: categoryId },
      ])
    },
    BOOT,
  )

  /**
   * A plain scalar carries neither shape `classifyBackReference` recognises as
   * a relationship, so it must refuse rather than fall through to `update` —
   * `removeRelated` is a mislabelled "unlink" action, not a general column
   * setter (#1442 review).
   */
  test(
    'removeRelated refuses to disconnect through a non-relationship field',
    async () => {
      const post = await harness.context.db.Post.create({ data: { title: 'story' } })

      const result = await harness.context.serverAction({
        listKey: 'Post',
        action: 'removeRelated',
        mode: 'disconnect',
        id: String(post?.id),
        field: 'title',
      })

      expect(result).toMatchObject({ removed: false })
      expect((result as { error?: string }).error).toContain('is not a relationship field')
      expect(await storedLinks(harness.url)).toEqual([{ title: 'story', author: null }])
    },
    BOOT,
  )

  test(
    "linkRelated writes the parent's id into the related row's own foreign key",
    async () => {
      const authorId = await seedAuthor('ada')
      const post = await harness.context.db.Post.create({ data: { title: 'loose' } })

      const result = await harness.context.serverAction({
        listKey: 'Post',
        action: 'linkRelated',
        id: String(post?.id),
        field: 'author',
        parentId: authorId,
      })

      expect(result).toEqual({ linked: true })
      expect(await storedLinks(harness.url)).toEqual([{ title: 'loose', author: authorId }])
    },
    BOOT,
  )

  // The write runs against the RELATED list, so it is that list's update access
  // that decides it — the reason the item form reverts a selection with.
  test(
    'linkRelated is refused when the related list denies the update',
    async () => {
      const authorId = await seedAuthor('ada')
      const post = await harness.context.db.Post.create({ data: { title: 'loose' } })

      const config: OpenSaasConfig = {
        db: { provider: 'postgresql', timestamps: true },
        lists: {
          Author: {
            fields: { name: text(), posts: relationship({ ref: 'Post.author', many: true }) },
            access: { operation: OPEN },
          },
          Post: {
            fields: { title: text(), author: relationship({ ref: 'Author.posts' }) },
            access: { operation: { ...OPEN, update: () => false } },
          },
        },
      }

      const result = await contextAt(config, { userId: 'u1' }).serverAction({
        listKey: 'Post',
        action: 'linkRelated',
        id: String(post?.id),
        field: 'author',
        parentId: authorId,
      })

      expect(result).toMatchObject({ linked: false })
      expect((result as { error?: string }).error).toBeTruthy()
      expect(await storedLinks(harness.url)).toEqual([{ title: 'loose', author: null }])
    },
    BOOT,
  )

  test(
    'linkRelated through a to-many back-reference has no column to write',
    async () => {
      const authorId = await seedAuthor('ada')

      const result = await harness.context.serverAction({
        listKey: 'Author',
        action: 'linkRelated',
        id: authorId,
        field: 'posts',
        parentId: authorId,
      })

      expect(result).toMatchObject({ linked: false })
      expect((result as { error?: string }).error).toContain('non-owning back-reference')
    },
    BOOT,
  )

  /**
   * The non-owning half of a one-to-one (#1442): same falsy `many` as the
   * to-many case above, but a different reason it owns no column — the guard
   * must reach the same refusal by ownership, not by re-deriving it from
   * arity.
   */
  test(
    'linkRelated through the non-owning half of a one-to-one has no column to write',
    async () => {
      const authorId = await seedAuthor('ada')
      const bioId = await seedBio('bio')

      const result = await harness.context.serverAction({
        listKey: 'Author',
        action: 'linkRelated',
        id: authorId,
        field: 'bio',
        parentId: bioId,
      })

      expect(result).toMatchObject({ linked: false })
      expect((result as { error?: string }).error).toContain('non-owning back-reference')
      expect(await storedBioLinks(harness.url)).toEqual([{ notes: 'bio', author: null }])
    },
    BOOT,
  )

  /**
   * A synthetic back-relation (#1442): undeclared on `Category`, so it never
   * appears in `listConfig.fields` and the old `isRelationshipField` guard
   * already refused it — but with the wrong message. Ownership is the reason.
   */
  test(
    'linkRelated through a synthetic back-relation has no column to write',
    async () => {
      const categoryId = await seedCategory('news')
      const post = await harness.context.db.Post.create({ data: { title: 'story' } })

      const result = await harness.context.serverAction({
        listKey: 'Category',
        action: 'linkRelated',
        id: categoryId,
        field: 'from_Post_category',
        parentId: String(post?.id),
      })

      expect(result).toMatchObject({ linked: false })
      expect((result as { error?: string }).error).toContain('non-owning back-reference')
    },
    BOOT,
  )
})
