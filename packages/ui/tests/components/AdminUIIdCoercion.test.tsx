import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { createTestContext, type TestContext } from '@opensaas/stack-core/testing'
import { AdminUI } from '../../src/components/AdminUI.js'
import { ItemForm } from '../../src/components/ItemForm.js'

const notFoundError = new Error('NEXT_NOT_FOUND')

vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  redirect: vi.fn(),
  notFound: () => {
    throw notFoundError
  },
}))

vi.mock('next/link.js', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

const BOOT = 120_000
const UUID = '019606b0-1f36-7000-8000-0000000000ab'

const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }

/** `Post` is integer-keyed; `Author` takes the config default. */
function config(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      Post: {
        fields: { title: text() },
        db: { idField: 'int autoincrement' },
        access: { operation: OPEN },
      },
      Author: { fields: { name: text() }, access: { operation: OPEN } },
    },
  }
}

/** Recover the routed element from AdminUI's shell, past the Suspense boundary. */
function routedContent(tree: React.ReactNode): React.ReactElement {
  const fragment = tree as React.ReactElement<{ children: React.ReactNode }>
  const wrapper = React.Children.toArray(fragment.props.children).find(
    (child): child is React.ReactElement<{ children: React.ReactNode }> =>
      React.isValidElement(child) && child.type === 'div',
  )
  if (!wrapper) throw new Error('AdminUI layout wrapper not found')
  const main = React.Children.toArray(wrapper.props.children).find(
    (child): child is React.ReactElement<{ children: React.ReactNode }> =>
      React.isValidElement(child) && child.type === 'main',
  )
  if (!main) throw new Error('AdminUI <main> not found')
  const boundary = main.props.children as React.ReactElement<{ children: React.ReactNode }>
  return React.isValidElement(boundary) && boundary.type === React.Suspense
    ? (boundary.props.children as React.ReactElement)
    : boundary
}

describe('admin routing parses an item id through the boundary coercion (ADR-0048)', () => {
  let harness: TestContext
  let context: AccessContext

  beforeAll(async () => {
    harness = await createTestContext(config(), { userId: 'admin' })
    context = harness.context as unknown as AccessContext
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  async function route(params: string[]) {
    return AdminUI({
      context,
      config: config(),
      params,
      basePath: '/admin',
      serverAction: harness.context.serverAction,
    })
  }

  it('404s a malformed id on an integer-keyed list', async () => {
    await expect(route(['post', 'not-an-int'])).rejects.toThrow(notFoundError)
  })

  it('routes a well-formed integer id to the edit form at its own type', async () => {
    const content = routedContent(await route(['post', '12']))
    expect(content.type).toBe(ItemForm)
    expect(content.props.itemId).toBe(12)
  })

  it('404s a malformed id on a uuid-keyed list', async () => {
    await expect(route(['author', 'not-a-uuid'])).rejects.toThrow(notFoundError)
  })

  it('routes a well-formed uuid to the edit form', async () => {
    const content = routedContent(await route(['author', UUID]))
    expect(content.type).toBe(ItemForm)
    expect(content.props.itemId).toBe(UUID)
  })

  it('leaves the create route alone', async () => {
    const content = routedContent(await route(['post', 'create']))
    expect(content.type).toBe(ItemForm)
    expect(content.props.mode).toBe('create')
  })
})
