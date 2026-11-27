import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { render, screen, within } from '@testing-library/react'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { engineContextOf, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { createTestContext, type TestContext } from '@opensaas/stack-core/testing'
import { AdminUI } from '../../src/components/AdminUI.js'
import { Dashboard } from '../../src/components/Dashboard.js'

const notFoundError = new Error('NEXT_NOT_FOUND')
const redirectError = new Error('NEXT_REDIRECT')
const redirect = vi.fn((url: string): never => {
  void url
  throw redirectError
})

vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin',
  redirect: (url: string) => redirect(url),
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
const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Post: list({
      fields: { title: text() },
      db: { idField: 'int autoincrement' },
      access: { operation: OPEN },
    }),
    Tag: list({ fields: { name: text() }, access: { operation: OPEN } }),
    SiteConfig: list({
      isSingleton: true,
      fields: { siteName: text() },
      access: { operation: OPEN },
    }),
  },
}

let harness: TestContext
let context: AccessContext

beforeAll(async () => {
  harness = await createTestContext(config, { userId: 'admin' })
  context = harness.context as unknown as AccessContext
  await harness.context.db.Post.create({ data: { title: 'one' } })
}, BOOT)

afterAll(async () => {
  await harness?.close()
})

function route(params: string[]) {
  return AdminUI({
    context,
    config,
    params,
    basePath: '/admin',
    serverAction: harness.context.serverAction,
  })
}

describe('admin routes 404 what is not there', () => {
  it('404s a URL that names no list', async () => {
    await expect(route(['does-not-exist'])).rejects.toBe(notFoundError)
  })

  it('404s an unknown list on its create and item routes too', async () => {
    await expect(route(['does-not-exist', 'create'])).rejects.toBe(notFoundError)
    await expect(route(['does-not-exist', '1'])).rejects.toBe(notFoundError)
  })

  it('404s segments after an item id', async () => {
    await expect(route(['post', '1', 'whatever'])).rejects.toBe(notFoundError)
  })

  it('404s segments after create', async () => {
    await expect(route(['post', 'create', 'whatever'])).rejects.toBe(notFoundError)
  })

  it('still routes a list, its create form and an item', async () => {
    await expect(route(['post'])).resolves.toBeTruthy()
    await expect(route(['post', 'create'])).resolves.toBeTruthy()
    await expect(route(['post', '1'])).resolves.toBeTruthy()
  })

  it('still sends any extra segment on a singleton back to its editor', async () => {
    redirect.mockClear()
    await expect(route(['site-config', 'create', 'whatever'])).rejects.toBe(redirectError)
    expect(redirect).toHaveBeenCalledWith('/admin/site-config')
  })
})

describe('Dashboard when a count fails', () => {
  function failingCountsFor(failing: string): AccessContext {
    const engine = engineContextOf(context)
    const db = new Proxy(engine.db, {
      get(target, key, receiver) {
        const delegate = Reflect.get(target, key, receiver)
        if (key !== failing) return delegate
        return new Proxy(delegate, {
          get(listTarget, member, listReceiver) {
            if (member === 'aggregate') {
              return () => Promise.reject(new Error('connection reset'))
            }
            return Reflect.get(listTarget, member, listReceiver)
          },
        })
      },
    })
    return new Proxy(engine, {
      get(target, key, receiver) {
        return key === 'db' ? db : Reflect.get(target, key, receiver)
      },
    })
  }

  it(
    'says the count is unavailable rather than showing 0 items',
    async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      render(await Dashboard({ context: failingCountsFor('Post'), config, basePath: '/admin' }))
      log.mockRestore()

      const postCard = screen.getByRole('link', { name: /^Post\b/ })
      expect(within(postCard).queryByText(/\b0 items\b/)).not.toBeInTheDocument()
      expect(within(postCard).getByText('Count unavailable')).toBeInTheDocument()

      const tagCard = screen.getByRole('link', { name: /^Tag\b/ })
      expect(within(tagCard).getByText('0 items')).toBeInTheDocument()
    },
    BOOT,
  )
})
