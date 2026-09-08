import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { relationship, text } from '@opensaas/stack-core/fields'
import { createTestContext, type TestContext } from '@opensaas/stack-core/testing'
import { deriveItemViewLayout } from '../../src/lib/deriveItemView.js'
import { resolveLinkEdge } from '../../src/components/RelationshipTable.js'
import { RelationshipTableClient } from '../../src/components/RelationshipTableClient.js'
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

type Rule = () => boolean | Record<string, unknown>

const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }

/**
 * The DEFAULT edit route: `User.posts` declares no `ui.itemView`, so
 * `deriveItemViewLayout` renders it as a Relationship table and the details
 * form never sees the field at all. The edge-writing control therefore has to
 * be on the table — a test that calls `prepareItemForm` directly is on the
 * `displayMode: 'picker'` route and cannot see this.
 */
function blogConfig(postUpdate: Rule = () => true): OpenSaasConfig {
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
  looseId: string
}

async function seed(harness: TestContext): Promise<Seeded> {
  const user = await harness.context.db.User.create({ data: { name: 'Ada' } })
  await harness.context.db.Post.create({
    data: { title: 'Owned', author: { connect: { id: String(user?.id) } } },
  })
  const loose = await harness.context.db.Post.create({ data: { title: 'Loose' } })
  return { userId: String(user?.id), looseId: String(loose?.id) }
}

async function linkedPostTitles(harness: TestContext, userId: string): Promise<string[]> {
  const record = await harness.context.db.User.where({ id: userId }).include('posts').first()
  const posts = record?.posts
  if (!Array.isArray(posts)) return []
  return posts.map((post) => String((post as { title: unknown }).title)).sort()
}

/**
 * Drive the default route: derive the layout the edit page derives, resolve the
 * table's controls the way `RelationshipTable` does, and render the client half
 * against the real secured server action.
 */
async function renderDefaultItemView(harness: TestContext, config: OpenSaasConfig, userId: string) {
  const layout = deriveItemViewLayout(config, 'User')
  const section = layout.sections[0]
  const context = harness.context as unknown as AccessContext
  const linkEdge = await resolveLinkEdge(section, config, 'User', context)
  const record = await harness.context.db.User.where({ id: userId }).include('posts').first()
  const rows = Array.isArray(record?.posts) ? (record.posts as Array<Record<string, unknown>>) : []

  render(
    <RelationshipTableClient
      title="Posts"
      relatedUrlKey="post"
      basePath="/admin"
      columns={['title']}
      fields={{ title: { type: 'text' } }}
      rows={rows.map((row) => ({ id: String(row.id), title: String(row.title) }))}
      count={rows.length}
      sumColumns={[]}
      sums={{}}
      removeMode="disconnect"
      relatedListKey={section.relatedListKey}
      backReferenceField={section.backReferenceField}
      parentId={userId}
      parentListKey="User"
      fieldName={section.fieldName}
      linkEdge={linkEdge ?? undefined}
      serverAction={harness.context.serverAction}
    />,
  )

  return { layout, linkEdge }
}

describe('the default edit route can write a to-many edge', () => {
  let allowed: TestContext
  let denied: TestContext

  beforeAll(async () => {
    allowed = await createTestContext(blogConfig(), { userId: 'admin' })
    denied = await createTestContext(
      blogConfig(() => ({ title: { equals: 'nothing matches' } })),
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

  it('routes a default-configured to-many to a table, out of the details form', async () => {
    const config = blogConfig()
    const seeded = await seed(allowed)
    const layout = deriveItemViewLayout(config, 'User')

    expect(layout.sections.map((section) => section.fieldName)).toEqual(['posts'])
    expect(layout.detailsFields).not.toContain('posts')

    // What the edit page hands the form on this route: the details fields only,
    // so the form's own edge-writing multi-select is never rendered here.
    const detailsListConfig = {
      ...config.lists.User,
      fields: { name: config.lists.User.fields.name },
    }
    const prepared = await prepareItemForm(
      allowed.context as unknown as AccessContext,
      config,
      'User',
      detailsListConfig,
      { id: seeded.userId, name: 'Ada' },
    )
    expect(prepared.serializableFields.posts).toBeUndefined()
  })

  it("links an existing post from the table, setting that post's foreign key", async () => {
    const config = blogConfig()
    const seeded = await seed(allowed)
    await renderDefaultItemView(allowed, config, seeded.userId)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Link Post/ }))
    await user.click(await screen.findByText('Loose'))

    await waitFor(() => expect(mockRefresh).toHaveBeenCalled())
    expect(await linkedPostTitles(allowed, seeded.userId)).toEqual(['Loose', 'Owned'])
  })

  it('shows the reason and writes nothing when the Post list denies the update', async () => {
    const config = blogConfig(() => ({ title: { equals: 'nothing matches' } }))
    const seeded = await seed(denied)
    await renderDefaultItemView(denied, config, seeded.userId)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Link Post/ }))
    await user.click(await screen.findByText('Loose'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Access denied or operation failed')
    expect(mockRefresh).not.toHaveBeenCalled()
    expect(await linkedPostTitles(denied, seeded.userId)).toEqual(['Owned'])
  })
})
