import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import type { OpenSaasConfig, OperationAccess, Session } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { createTestDatabase } from '@opensaas/stack-core/testing'
import { SingletonView } from '../../src/components/SingletonView.js'

vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/settings',
}))

vi.mock('next/link.js', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

const BOOT = 120_000

type RuleArgs = { session: Session | null }

function adminOrNothing(args: RuleArgs): boolean
function adminOrNothing({ session }: RuleArgs): boolean | null | undefined {
  if (session?.role === 'admin') return true
  return session?.role === 'returns-null' ? null : undefined
}

const serverAction = async () => null

afterEach(() => {
  cleanup()
})

function singletonConfig(operation: OperationAccess, autoCreate = true): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      Settings: {
        isSingleton: autoCreate ? true : { autoCreate: false },
        fields: { siteName: text() },
        access: { operation },
      },
    },
  }
}

async function renderSingleton(config: OpenSaasConfig, session: Session | null, sudo = false) {
  const database = await createTestDatabase(config)
  try {
    const base = database.context(session)
    const element = await SingletonView({
      context: sudo ? base.sudo() : base,
      config,
      listKey: 'Settings',
      basePath: '/admin',
      serverAction,
    })
    return render(element)
  } finally {
    await database.close()
  }
}

function expectNoEditor(): void {
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Create' })).not.toBeInTheDocument()
  expect(screen.queryByText('Edit Settings')).not.toBeInTheDocument()
  expect(screen.queryByText('Create Settings')).not.toBeInTheDocument()
}

describe('SingletonView reads the Session vocabulary', () => {
  it.each([
    ['null', 'returns-null'],
    ['undefined', 'returns-undefined'],
  ])(
    'shows no editor when the query rule returns %s',
    async (_label, role) => {
      const config = singletonConfig({
        query: adminOrNothing,
        create: () => true,
        update: () => true,
      })
      const { container } = await renderSingleton(config, { role })

      expect(container.querySelector('[data-slot="singleton-view-unavailable"]')).not.toBeNull()
      expect(screen.getByText("You don't have access to Settings.")).toBeInTheDocument()
      expectNoEditor()
    },
    BOOT,
  )

  it.each([
    ['null', 'returns-null'],
    ['undefined', 'returns-undefined'],
  ])(
    'offers no create form when the create rule returns %s',
    async (_label, role) => {
      const config = singletonConfig(
        { query: () => true, create: adminOrNothing, update: () => true },
        false,
      )
      await renderSingleton(config, { role })

      expect(screen.getByText('There is no Settings record yet.')).toBeInTheDocument()
      expectNoEditor()
    },
    BOOT,
  )

  it(
    'offers the create form where create is allowed',
    async () => {
      const config = singletonConfig(
        { query: () => true, create: adminOrNothing, update: () => true },
        false,
      )
      await renderSingleton(config, { role: 'admin' })

      expect(screen.getByText('Create Settings')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
    },
    BOOT,
  )

  it(
    'shows the editor to a sudo context on a singleton with no operation rules',
    async () => {
      const config: OpenSaasConfig = {
        db: { provider: 'postgresql' },
        lists: { Settings: { isSingleton: { autoCreate: false }, fields: { siteName: text() } } },
      }
      await renderSingleton(config, null, true)

      expect(screen.getByText('Create Settings')).toBeInTheDocument()
      expect(screen.queryByText("You don't have access to Settings.")).not.toBeInTheDocument()
    },
    BOOT,
  )
})
