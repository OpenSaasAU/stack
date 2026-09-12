import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { relationship, text } from '@opensaas/stack-core/fields'
import { createTestContext, type TestContext } from '@opensaas/stack-core/testing'
import { ItemFormClient } from '../../src/components/ItemFormClient.js'
import { prepareItemForm } from '../../src/lib/prepareItemForm.js'

const mockPush = vi.fn()
const mockRefresh = vi.fn()
vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}))

vi.mock('next/link.js', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

const BOOT = 120_000

const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }

/**
 * `User.posts` is a to-many whose foreign key lives on `Post.author`, so every
 * edge the form writes is an update of a Post row under the Post list's own
 * access (ADR-0050). `postUpdate` is what a test denies to watch the form
 * revert.
 */
function blogConfig(postUpdate: () => boolean = () => true): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      User: {
        fields: {
          name: text(),
          posts: relationship({ ref: 'Post.author', many: true }),
        },
        access: { operation: OPEN },
      },
      Post: {
        fields: {
          title: text(),
          author: relationship({ ref: 'User.posts' }),
        },
        access: { operation: { ...OPEN, update: postUpdate } },
      },
    },
  }
}

interface Seeded {
  userId: string
  ownedId: string
  looseId: string
}

async function seed(harness: TestContext): Promise<Seeded> {
  const user = await harness.context.db.User.create({ data: { name: 'Ada' } })
  const owned = await harness.context.db.Post.create({
    data: { title: 'Owned', author: { connect: { id: String(user?.id) } } },
  })
  const loose = await harness.context.db.Post.create({ data: { title: 'Loose' } })
  return { userId: String(user?.id), ownedId: String(owned?.id), looseId: String(loose?.id) }
}

async function linkedPostTitles(harness: TestContext, userId: string): Promise<string[]> {
  const record = await harness.context.db.User.where({ id: userId }).include('posts').first()
  const posts = record?.posts
  if (!Array.isArray(posts)) return []
  return posts.map((post) => String((post as { title: unknown }).title)).sort()
}

async function renderUserForm(harness: TestContext, config: OpenSaasConfig, userId: string) {
  const context = harness.context as unknown as AccessContext
  const record = await harness.context.db.User.where({ id: userId }).include('posts').first()
  const prepared = await prepareItemForm(
    context,
    config,
    'User',
    config.lists.User,
    record as Record<string, unknown>,
    'update',
  )

  render(
    <ItemFormClient
      listKey="User"
      urlKey="user"
      mode="edit"
      fields={prepared.serializableFields}
      initialData={prepared.initialData}
      itemId={userId}
      basePath="/admin"
      serverAction={harness.context.serverAction}
      relationshipData={prepared.relationshipData}
    />,
  )

  return prepared
}

describe("the item form's to-many edges are writes against the related list", () => {
  let allowed: TestContext
  let denied: TestContext

  beforeAll(async () => {
    allowed = await createTestContext(blogConfig(), { userId: 'admin' })
    denied = await createTestContext(
      blogConfig(() => false),
      { userId: 'admin' },
    )
  }, BOOT)

  afterAll(async () => {
    await allowed?.close()
    await denied?.close()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    await allowed.truncate()
    await denied.truncate()
  })

  it('writes the plan on a to-many whose back-reference owns the foreign key', async () => {
    const config = blogConfig()
    const seeded = await seed(allowed)
    const prepared = await renderUserForm(allowed, config, seeded.userId)

    expect(prepared.serializableFields.posts.edgeWrite).toEqual({
      relatedListKey: 'Post',
      backReferenceField: 'author',
    })
    // The mark that stopped the control rendering is gone with it.
    expect(prepared.serializableFields.posts.readOnly).toBeUndefined()
  })

  it("selecting a post updates that post's foreign key under the Post list's access", async () => {
    const config = blogConfig()
    const seeded = await seed(allowed)
    await renderUserForm(allowed, config, seeded.userId)

    const user = userEvent.setup()
    await user.click(screen.getByText('Connect Existing'))
    await user.click(await screen.findByText('Loose'))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/admin/user'))
    expect(await linkedPostTitles(allowed, seeded.userId)).toEqual(['Loose', 'Owned'])
  })

  it('deselecting a post clears that foreign key', async () => {
    const config = blogConfig()
    const seeded = await seed(allowed)
    await renderUserForm(allowed, config, seeded.userId)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/admin/user'))
    expect(await linkedPostTitles(allowed, seeded.userId)).toEqual([])
  })

  it('reverts the selection and shows the reason when the related list denies the write', async () => {
    const config = blogConfig(() => false)
    const seeded = await seed(denied)
    await renderUserForm(denied, config, seeded.userId)

    const user = userEvent.setup()
    await user.click(screen.getByText('Connect Existing'))
    await user.click(await screen.findByText('Loose'))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Access denied or operation failed')).toBeInTheDocument()
    // Reverted: the control shows what the database actually holds, and the
    // form stayed put rather than navigating away on a write that never landed.
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'Loose' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: 'Owned' })).toBeInTheDocument()
    expect(mockPush).not.toHaveBeenCalled()
    expect(await linkedPostTitles(denied, seeded.userId)).toEqual(['Owned'])
  })
})

/**
 * The same shape on an `int autoincrement` list (ADR-0048). A record's id
 * arrives as a number here and the form carries ids as strings, so a baseline
 * that dropped the number would leave a deselect with nothing to diff — and
 * the form would navigate away reporting a save it never made.
 */
function intKeyedConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql', idField: 'int autoincrement' },
    lists: {
      User: {
        fields: {
          name: text(),
          posts: relationship({ ref: 'Post.author', many: true }),
        },
        access: { operation: OPEN },
      },
      Post: {
        fields: {
          title: text(),
          author: relationship({ ref: 'User.posts' }),
        },
        access: { operation: OPEN },
      },
    },
  }
}

describe('an integer-keyed related list round-trips its ids through the form', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(intKeyedConfig(), { userId: 'admin' })
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    await harness.truncate()
  })

  it('clears the foreign key when a numeric-id row is deselected', async () => {
    const config = intKeyedConfig()
    const owner = await harness.context.db.User.create({ data: { name: 'Ada' } })
    const userId = String(owner?.id)
    const post = await harness.context.db.Post.create({
      data: { title: 'Owned', author: { connect: { id: owner?.id } } },
    })
    const postId = String(post?.id)

    const prepared = await renderUserForm(harness, config, userId)
    expect(prepared.initialData.posts).toEqual([postId])

    const actor = userEvent.setup()
    await actor.click(screen.getByRole('button', { name: 'Remove' }))
    await actor.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/admin/user'))
    expect(await linkedPostTitles(harness, userId)).toEqual([])
  })
})
